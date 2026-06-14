mod database;
mod security;

use database::{load_wealth_state, open_encrypted, save_wealth_state, WealthState};
use security::{initialize_vault, unlock_vault, DatabaseKey, VaultMetadata};
use serde::Serialize;
use std::{
    fs,
    path::PathBuf,
    sync::{Mutex, MutexGuard},
};
use tauri::Manager;

#[derive(Default)]
struct AppState {
    database_key: Mutex<Option<DatabaseKey>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryResponse {
    recovery_key: String,
}

#[tauri::command]
fn initialize(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    password: String,
) -> Result<RecoveryResponse, String> {
    let paths = vault_paths(&app)?;
    if paths.metadata.exists() || paths.database.exists() {
        return Err("安全存储已经初始化".into());
    }
    fs::create_dir_all(&paths.directory).map_err(|_| "无法创建应用数据目录")?;

    let (initialization, database_key) =
        initialize_vault(&password).map_err(|error| error.to_string())?;
    open_encrypted(&paths.database, database_key.as_bytes()).map_err(|error| error.to_string())?;
    let metadata_json =
        serde_json::to_vec_pretty(&initialization.metadata).map_err(|_| "无法保存安全元数据")?;
    if fs::write(&paths.metadata, metadata_json).is_err() {
        let _ = fs::remove_file(&paths.database);
        return Err("无法保存安全元数据".into());
    }
    *key_guard(&state)? = Some(database_key);

    Ok(RecoveryResponse {
        recovery_key: initialization.recovery_key,
    })
}

#[tauri::command]
fn unlock(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    password: String,
) -> Result<bool, String> {
    let paths = vault_paths(&app)?;
    let metadata_bytes = fs::read(&paths.metadata).map_err(|_| "凭据无效")?;
    let metadata: VaultMetadata =
        serde_json::from_slice(&metadata_bytes).map_err(|_| "凭据无效")?;
    let database_key = unlock_vault(&password, &metadata).map_err(|_| "凭据无效")?;
    open_encrypted(&paths.database, database_key.as_bytes()).map_err(|_| "凭据无效")?;
    *key_guard(&state)? = Some(database_key);
    Ok(true)
}

#[tauri::command]
fn lock(state: tauri::State<AppState>) -> Result<(), String> {
    *key_guard(&state)? = None;
    Ok(())
}

#[tauri::command]
fn load_data(app: tauri::AppHandle, state: tauri::State<AppState>) -> Result<WealthState, String> {
    with_connection(&app, &state, |connection| {
        load_wealth_state(connection).map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn save_data(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    data: WealthState,
) -> Result<WealthState, String> {
    with_connection(&app, &state, |connection| {
        save_wealth_state(connection, &data).map_err(|error| error.to_string())?;
        load_wealth_state(connection).map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn vault_status(app: tauri::AppHandle) -> Result<bool, String> {
    let paths = vault_paths(&app)?;
    Ok(paths.metadata.exists() && paths.database.exists())
}

fn with_connection<T>(
    app: &tauri::AppHandle,
    state: &tauri::State<AppState>,
    action: impl FnOnce(&mut rusqlite::Connection) -> Result<T, String>,
) -> Result<T, String> {
    let guard = key_guard(state)?;
    let key = guard.as_ref().ok_or("应用已锁定")?;
    let paths = vault_paths(app)?;
    let mut connection =
        open_encrypted(&paths.database, key.as_bytes()).map_err(|error| error.to_string())?;
    action(&mut connection)
}

fn key_guard<'a>(
    state: &'a tauri::State<'a, AppState>,
) -> Result<MutexGuard<'a, Option<DatabaseKey>>, String> {
    state
        .database_key
        .lock()
        .map_err(|_| "安全会话不可用".into())
}

struct VaultPaths {
    directory: PathBuf,
    metadata: PathBuf,
    database: PathBuf,
}

fn vault_paths(app: &tauri::AppHandle) -> Result<VaultPaths, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|_| "无法确定应用数据目录")?;
    Ok(VaultPaths {
        metadata: directory.join("vault.json"),
        database: directory.join("wealth.db"),
        directory,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            initialize,
            unlock,
            lock,
            load_data,
            save_data,
            vault_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running wealth compass");
}
