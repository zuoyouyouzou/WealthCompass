use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Algorithm, Argon2, Params, Version,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    XChaCha20Poly1305, XNonce,
};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use zeroize::{Zeroize, ZeroizeOnDrop};

const RECOVERY_KEY_BYTES: usize = 32;
const DATABASE_KEY_BYTES: usize = 32;

#[derive(Debug, Error)]
pub enum SecurityError {
    #[error("主密码至少需要 12 个字符")]
    WeakPassword,
    #[error("无法初始化安全存储")]
    Initialization,
    #[error("凭据无效")]
    InvalidCredentials,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultMetadata {
    pub password_hash: String,
    pub password_salt: String,
    pub wrapped_database_key: String,
    pub wrap_nonce: String,
    pub recovery_hash: String,
    pub recovery_salt: String,
    pub recovery_wrapped_database_key: String,
    pub recovery_wrap_nonce: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultInitialization {
    pub metadata: VaultMetadata,
    pub recovery_key: String,
}

#[derive(Zeroize, ZeroizeOnDrop)]
pub struct DatabaseKey([u8; DATABASE_KEY_BYTES]);

impl DatabaseKey {
    pub fn as_bytes(&self) -> &[u8; DATABASE_KEY_BYTES] {
        &self.0
    }
}

pub fn initialize_vault(
    password: &str,
) -> Result<(VaultInitialization, DatabaseKey), SecurityError> {
    if password.chars().count() < 12 {
        return Err(SecurityError::WeakPassword);
    }

    let argon2 = key_deriver()?;
    let password_salt = SaltString::generate(&mut OsRng);
    let password_hash = argon2
        .hash_password(password.as_bytes(), &password_salt)
        .map_err(|_| SecurityError::Initialization)?
        .to_string();

    let mut wrapping_key = [0_u8; DATABASE_KEY_BYTES];
    argon2
        .hash_password_into(
            password.as_bytes(),
            password_salt.as_str().as_bytes(),
            &mut wrapping_key,
        )
        .map_err(|_| SecurityError::Initialization)?;

    let mut database_key = DatabaseKey([0_u8; DATABASE_KEY_BYTES]);
    OsRng.fill_bytes(&mut database_key.0);
    let cipher = XChaCha20Poly1305::new_from_slice(&wrapping_key)
        .map_err(|_| SecurityError::Initialization)?;
    let mut nonce = [0_u8; 24];
    OsRng.fill_bytes(&mut nonce);
    let wrapped_database_key = cipher
        .encrypt(XNonce::from_slice(&nonce), database_key.0.as_slice())
        .map_err(|_| SecurityError::Initialization)?;
    wrapping_key.zeroize();

    let mut recovery_key = [0_u8; RECOVERY_KEY_BYTES];
    OsRng.fill_bytes(&mut recovery_key);
    let recovery_key_display = URL_SAFE_NO_PAD.encode(recovery_key);
    let recovery_salt = SaltString::generate(&mut OsRng);
    let recovery_hash = Argon2::default()
        .hash_password(recovery_key_display.as_bytes(), &recovery_salt)
        .map_err(|_| SecurityError::Initialization)?
        .to_string();
    let mut recovery_wrapping_key = [0_u8; DATABASE_KEY_BYTES];
    argon2
        .hash_password_into(
            recovery_key_display.as_bytes(),
            recovery_salt.as_str().as_bytes(),
            &mut recovery_wrapping_key,
        )
        .map_err(|_| SecurityError::Initialization)?;
    let recovery_cipher = XChaCha20Poly1305::new_from_slice(&recovery_wrapping_key)
        .map_err(|_| SecurityError::Initialization)?;
    let mut recovery_nonce = [0_u8; 24];
    OsRng.fill_bytes(&mut recovery_nonce);
    let recovery_wrapped_database_key = recovery_cipher
        .encrypt(
            XNonce::from_slice(&recovery_nonce),
            database_key.0.as_slice(),
        )
        .map_err(|_| SecurityError::Initialization)?;
    recovery_wrapping_key.zeroize();
    recovery_key.zeroize();

    Ok((
        VaultInitialization {
            metadata: VaultMetadata {
                password_hash,
                password_salt: password_salt.to_string(),
                wrapped_database_key: URL_SAFE_NO_PAD.encode(wrapped_database_key),
                wrap_nonce: URL_SAFE_NO_PAD.encode(nonce),
                recovery_hash,
                recovery_salt: recovery_salt.to_string(),
                recovery_wrapped_database_key: URL_SAFE_NO_PAD
                    .encode(recovery_wrapped_database_key),
                recovery_wrap_nonce: URL_SAFE_NO_PAD.encode(recovery_nonce),
            },
            recovery_key: recovery_key_display,
        },
        database_key,
    ))
}

pub fn unlock_vault(
    password: &str,
    metadata: &VaultMetadata,
) -> Result<DatabaseKey, SecurityError> {
    let parsed = PasswordHash::new(&metadata.password_hash)
        .map_err(|_| SecurityError::InvalidCredentials)?;
    if Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_err()
    {
        return Err(SecurityError::InvalidCredentials);
    }

    let mut wrapping_key = [0_u8; DATABASE_KEY_BYTES];
    key_deriver()?
        .hash_password_into(
            password.as_bytes(),
            metadata.password_salt.as_bytes(),
            &mut wrapping_key,
        )
        .map_err(|_| SecurityError::InvalidCredentials)?;
    let nonce = URL_SAFE_NO_PAD
        .decode(&metadata.wrap_nonce)
        .map_err(|_| SecurityError::InvalidCredentials)?;
    let wrapped_key = URL_SAFE_NO_PAD
        .decode(&metadata.wrapped_database_key)
        .map_err(|_| SecurityError::InvalidCredentials)?;
    if nonce.len() != 24 {
        return Err(SecurityError::InvalidCredentials);
    }
    let cipher = XChaCha20Poly1305::new_from_slice(&wrapping_key)
        .map_err(|_| SecurityError::InvalidCredentials)?;
    let plaintext = cipher
        .decrypt(XNonce::from_slice(&nonce), wrapped_key.as_slice())
        .map_err(|_| SecurityError::InvalidCredentials)?;
    wrapping_key.zeroize();
    let key: [u8; DATABASE_KEY_BYTES] = plaintext
        .try_into()
        .map_err(|_| SecurityError::InvalidCredentials)?;
    Ok(DatabaseKey(key))
}

fn key_deriver() -> Result<Argon2<'static>, SecurityError> {
    let params = Params::new(64 * 1024, 3, 1, Some(DATABASE_KEY_BYTES))
        .map_err(|_| SecurityError::Initialization)?;
    Ok(Argon2::new(Algorithm::Argon2id, Version::V0x13, params))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initializes_and_verifies_vault() {
        let (initialization, original_key) = initialize_vault("a-secure-password-2026").unwrap();
        let unlocked_key =
            unlock_vault("a-secure-password-2026", &initialization.metadata).unwrap();
        assert_eq!(unlocked_key.as_bytes(), original_key.as_bytes());
        assert!(unlock_vault("incorrect-password", &initialization.metadata).is_err());
        assert!(!initialization.recovery_key.is_empty());
        assert!(!initialization
            .metadata
            .recovery_wrapped_database_key
            .contains(&initialization.recovery_key));
    }

    #[test]
    fn rejects_short_passwords() {
        assert!(matches!(
            initialize_vault("short"),
            Err(SecurityError::WeakPassword)
        ));
    }
}
