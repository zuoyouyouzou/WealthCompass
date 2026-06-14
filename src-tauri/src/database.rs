use rusqlite::{params, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::path::Path;
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum DatabaseError {
    #[error("无法打开加密数据库")]
    Open,
    #[error("数据库迁移失败")]
    Migration,
    #[error("无法读取财富数据")]
    Read,
    #[error("无法保存财富数据")]
    Write,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WealthState {
    pub accounts: Vec<Account>,
    pub properties: Vec<PropertyAsset>,
    pub liabilities: Vec<Liability>,
    pub positions: Vec<InvestmentPosition>,
    pub transactions: Vec<FinancialTransaction>,
    pub targets: MonthlyTargets,
    pub opening_net_worth: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub balance: f64,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PropertyAsset {
    pub id: String,
    pub name: String,
    pub valuation: f64,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Liability {
    pub id: String,
    pub name: String,
    pub balance: f64,
    pub property_id: Option<String>,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InvestmentPosition {
    pub id: String,
    pub account_id: String,
    pub symbol: String,
    pub name: String,
    pub market_value: f64,
    pub cost_basis: f64,
    pub realized_profit: f64,
    pub asset_class: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FinancialTransaction {
    pub id: String,
    pub date: String,
    pub kind: String,
    pub amount: f64,
    pub category: String,
    pub account_id: String,
    pub target_account_id: Option<String>,
    pub note: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyTargets {
    pub month: String,
    pub net_worth_growth: f64,
    pub net_cash_flow: f64,
    pub investment_return: f64,
}

pub fn open_encrypted(path: &Path, key: &[u8; 32]) -> Result<Connection, DatabaseError> {
    let mut connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
    )
    .map_err(|_| DatabaseError::Open)?;

    let key_hex = hex::encode(key);
    connection
        .execute_batch(&format!(
            "PRAGMA key = \"x'{key_hex}'\";
             PRAGMA cipher_memory_security = ON;
             PRAGMA foreign_keys = ON;"
        ))
        .map_err(|_| DatabaseError::Open)?;
    connection
        .query_row("SELECT count(*) FROM sqlite_master", [], |_| Ok(()))
        .map_err(|_| DatabaseError::Open)?;
    migrate(&mut connection)?;
    Ok(connection)
}

pub fn load_wealth_state(connection: &Connection) -> Result<WealthState, DatabaseError> {
    let accounts = query_accounts(connection)?;
    let properties = query_properties(connection)?;
    let liabilities = query_liabilities(connection)?;
    let positions = query_positions(connection)?;
    let transactions = query_transactions(connection)?;
    let targets = connection
        .query_row(
            "SELECT month, net_worth_growth_minor, net_cash_flow_minor,
                    investment_return_minor
             FROM monthly_targets ORDER BY month DESC LIMIT 1",
            [],
            |row| {
                Ok(MonthlyTargets {
                    month: row.get(0)?,
                    net_worth_growth: from_minor(row.get(1)?),
                    net_cash_flow: from_minor(row.get(2)?),
                    investment_return: from_minor(row.get(3)?),
                })
            },
        )
        .unwrap_or_else(|_| default_targets());
    let opening_net_worth = connection
        .query_row(
            "SELECT value_minor FROM app_settings WHERE key = 'opening_net_worth'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(from_minor)
        .unwrap_or(0.0);

    Ok(WealthState {
        accounts,
        properties,
        liabilities,
        positions,
        transactions,
        targets,
        opening_net_worth,
    })
}

pub fn save_wealth_state(
    connection: &mut Connection,
    state: &WealthState,
) -> Result<(), DatabaseError> {
    validate_state(state)?;
    let before = load_wealth_state(connection).unwrap_or_default();
    let transaction = connection.transaction().map_err(|_| DatabaseError::Write)?;

    transaction
        .execute_batch(
            "DELETE FROM transactions;
             DELETE FROM investment_positions;
             DELETE FROM liability_snapshots;
             DELETE FROM liabilities;
             DELETE FROM property_valuations;
             DELETE FROM properties;
             DELETE FROM balance_snapshots;
             DELETE FROM accounts;
             DELETE FROM categories;
             DELETE FROM monthly_targets;",
        )
        .map_err(|_| DatabaseError::Write)?;

    for account in &state.accounts {
        transaction
            .execute(
                "INSERT INTO accounts(id, name, kind) VALUES (?1, ?2, ?3)",
                params![account.id, account.name, account.kind],
            )
            .map_err(|_| DatabaseError::Write)?;
        transaction
            .execute(
                "INSERT INTO balance_snapshots
                    (id, account_id, balance_minor, snapshot_date, is_confirmed)
                 VALUES (?1, ?2, ?3, ?4, 1)",
                params![
                    Uuid::new_v4().to_string(),
                    account.id,
                    to_minor(account.balance),
                    account.updated_at
                ],
            )
            .map_err(|_| DatabaseError::Write)?;
    }

    for property in &state.properties {
        transaction
            .execute(
                "INSERT INTO properties(id, name) VALUES (?1, ?2)",
                params![property.id, property.name],
            )
            .map_err(|_| DatabaseError::Write)?;
        transaction
            .execute(
                "INSERT INTO property_valuations
                    (id, property_id, value_minor, valuation_date)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    Uuid::new_v4().to_string(),
                    property.id,
                    to_minor(property.valuation),
                    property.updated_at
                ],
            )
            .map_err(|_| DatabaseError::Write)?;
    }

    for liability in &state.liabilities {
        transaction
            .execute(
                "INSERT INTO liabilities(id, name, property_id) VALUES (?1, ?2, ?3)",
                params![liability.id, liability.name, liability.property_id],
            )
            .map_err(|_| DatabaseError::Write)?;
        transaction
            .execute(
                "INSERT INTO liability_snapshots
                    (id, liability_id, balance_minor, snapshot_date)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    Uuid::new_v4().to_string(),
                    liability.id,
                    to_minor(liability.balance),
                    liability.updated_at
                ],
            )
            .map_err(|_| DatabaseError::Write)?;
    }

    for position in &state.positions {
        transaction
            .execute(
                "INSERT INTO investment_positions
                    (id, account_id, symbol, name, market_value_minor,
                     cost_basis_minor, realized_profit_minor, asset_class)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    position.id,
                    position.account_id,
                    position.symbol,
                    position.name,
                    to_minor(position.market_value),
                    to_minor(position.cost_basis),
                    to_minor(position.realized_profit),
                    position.asset_class
                ],
            )
            .map_err(|_| DatabaseError::Write)?;
    }

    for item in &state.transactions {
        let category_id = format!("category:{}:{}", item.kind, item.category);
        transaction
            .execute(
                "INSERT OR IGNORE INTO categories(id, name, kind)
                 VALUES (?1, ?2, ?3)",
                params![category_id, item.category, item.kind],
            )
            .map_err(|_| DatabaseError::Write)?;
        transaction
            .execute(
                "INSERT INTO transactions
                    (id, occurred_on, kind, amount_minor, account_id,
                     target_account_id, category_id, note)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    item.id,
                    item.date,
                    item.kind,
                    to_minor(item.amount),
                    item.account_id,
                    item.target_account_id,
                    category_id,
                    item.note
                ],
            )
            .map_err(|_| DatabaseError::Write)?;
    }

    let month = if state.targets.month.is_empty() {
        "2026-07"
    } else {
        &state.targets.month
    };
    transaction
        .execute(
            "INSERT INTO monthly_targets
                (month, net_worth_growth_minor, net_cash_flow_minor,
                 investment_return_minor, updated_at)
             VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP)",
            params![
                month,
                to_minor(state.targets.net_worth_growth),
                to_minor(state.targets.net_cash_flow),
                to_minor(state.targets.investment_return)
            ],
        )
        .map_err(|_| DatabaseError::Write)?;
    transaction
        .execute(
            "INSERT INTO app_settings(key, value_minor)
             VALUES ('opening_net_worth', ?1)
             ON CONFLICT(key) DO UPDATE SET value_minor = excluded.value_minor",
            params![to_minor(state.opening_net_worth)],
        )
        .map_err(|_| DatabaseError::Write)?;
    transaction
        .execute(
            "INSERT INTO audit_log
                (id, entity_type, entity_id, action, before_json, after_json, reason)
             VALUES (?1, 'wealth_state', 'primary', 'replace', ?2, ?3, '用户保存')",
            params![
                Uuid::new_v4().to_string(),
                serde_json::to_string(&before).map_err(|_| DatabaseError::Write)?,
                serde_json::to_string(state).map_err(|_| DatabaseError::Write)?
            ],
        )
        .map_err(|_| DatabaseError::Write)?;

    transaction.commit().map_err(|_| DatabaseError::Write)
}

fn migrate(connection: &mut Connection) -> Result<(), DatabaseError> {
    let transaction = connection
        .transaction()
        .map_err(|_| DatabaseError::Migration)?;
    transaction
        .execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS accounts (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                kind TEXT NOT NULL,
                currency TEXT NOT NULL DEFAULT 'CNY',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                archived_at TEXT
            );
            CREATE TABLE IF NOT EXISTS balance_snapshots (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL REFERENCES accounts(id),
                balance_minor INTEGER NOT NULL,
                snapshot_date TEXT NOT NULL,
                is_confirmed INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS properties (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                archived_at TEXT
            );
            CREATE TABLE IF NOT EXISTS property_valuations (
                id TEXT PRIMARY KEY,
                property_id TEXT NOT NULL REFERENCES properties(id),
                value_minor INTEGER NOT NULL,
                valuation_date TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS liabilities (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                property_id TEXT REFERENCES properties(id),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                archived_at TEXT
            );
            CREATE TABLE IF NOT EXISTS liability_snapshots (
                id TEXT PRIMARY KEY,
                liability_id TEXT NOT NULL REFERENCES liabilities(id),
                balance_minor INTEGER NOT NULL,
                snapshot_date TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS investment_positions (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL REFERENCES accounts(id),
                symbol TEXT NOT NULL,
                name TEXT NOT NULL,
                market_value_minor INTEGER NOT NULL,
                cost_basis_minor INTEGER NOT NULL,
                realized_profit_minor INTEGER NOT NULL DEFAULT 0,
                asset_class TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS categories (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                kind TEXT NOT NULL,
                is_system INTEGER NOT NULL DEFAULT 0,
                UNIQUE(name, kind)
            );
            CREATE TABLE IF NOT EXISTS transactions (
                id TEXT PRIMARY KEY,
                occurred_on TEXT NOT NULL,
                kind TEXT NOT NULL,
                amount_minor INTEGER NOT NULL CHECK(amount_minor >= 0),
                account_id TEXT NOT NULL REFERENCES accounts(id),
                target_account_id TEXT REFERENCES accounts(id),
                category_id TEXT REFERENCES categories(id),
                note TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                deleted_at TEXT,
                CHECK (
                    (kind = 'transfer' AND target_account_id IS NOT NULL)
                    OR (kind <> 'transfer' AND target_account_id IS NULL)
                )
            );
            CREATE TABLE IF NOT EXISTS monthly_targets (
                month TEXT PRIMARY KEY,
                net_worth_growth_minor INTEGER NOT NULL,
                net_cash_flow_minor INTEGER NOT NULL,
                investment_return_minor INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value_minor INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS audit_log (
                id TEXT PRIMARY KEY,
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                action TEXT NOT NULL,
                before_json TEXT,
                after_json TEXT,
                reason TEXT NOT NULL,
                occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            INSERT OR IGNORE INTO schema_migrations(version) VALUES (1);
            INSERT OR IGNORE INTO schema_migrations(version) VALUES (2);
            "#,
        )
        .map_err(|_| DatabaseError::Migration)?;
    transaction.commit().map_err(|_| DatabaseError::Migration)
}

fn query_accounts(connection: &Connection) -> Result<Vec<Account>, DatabaseError> {
    let mut statement = connection
        .prepare(
            "SELECT a.id, a.name, a.kind, b.balance_minor, b.snapshot_date
             FROM accounts a
             JOIN balance_snapshots b ON b.id = (
                 SELECT id FROM balance_snapshots
                 WHERE account_id = a.id ORDER BY snapshot_date DESC, created_at DESC LIMIT 1
             )
             WHERE a.archived_at IS NULL ORDER BY a.created_at, a.name",
        )
        .map_err(|_| DatabaseError::Read)?;
    let rows = statement
        .query_map([], |row| {
            Ok(Account {
                id: row.get(0)?,
                name: row.get(1)?,
                kind: row.get(2)?,
                balance: from_minor(row.get(3)?),
                updated_at: row.get(4)?,
            })
        })
        .map_err(|_| DatabaseError::Read)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|_| DatabaseError::Read)
}

fn query_properties(connection: &Connection) -> Result<Vec<PropertyAsset>, DatabaseError> {
    let mut statement = connection
        .prepare(
            "SELECT p.id, p.name, v.value_minor, v.valuation_date
             FROM properties p
             JOIN property_valuations v ON v.id = (
                 SELECT id FROM property_valuations
                 WHERE property_id = p.id ORDER BY valuation_date DESC, created_at DESC LIMIT 1
             )
             WHERE p.archived_at IS NULL ORDER BY p.created_at, p.name",
        )
        .map_err(|_| DatabaseError::Read)?;
    let rows = statement
        .query_map([], |row| {
            Ok(PropertyAsset {
                id: row.get(0)?,
                name: row.get(1)?,
                valuation: from_minor(row.get(2)?),
                updated_at: row.get(3)?,
            })
        })
        .map_err(|_| DatabaseError::Read)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|_| DatabaseError::Read)
}

fn query_liabilities(connection: &Connection) -> Result<Vec<Liability>, DatabaseError> {
    let mut statement = connection
        .prepare(
            "SELECT l.id, l.name, s.balance_minor, l.property_id, s.snapshot_date
             FROM liabilities l
             JOIN liability_snapshots s ON s.id = (
                 SELECT id FROM liability_snapshots
                 WHERE liability_id = l.id ORDER BY snapshot_date DESC, created_at DESC LIMIT 1
             )
             WHERE l.archived_at IS NULL ORDER BY l.created_at, l.name",
        )
        .map_err(|_| DatabaseError::Read)?;
    let rows = statement
        .query_map([], |row| {
            Ok(Liability {
                id: row.get(0)?,
                name: row.get(1)?,
                balance: from_minor(row.get(2)?),
                property_id: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|_| DatabaseError::Read)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|_| DatabaseError::Read)
}

fn query_positions(connection: &Connection) -> Result<Vec<InvestmentPosition>, DatabaseError> {
    let mut statement = connection
        .prepare(
            "SELECT id, account_id, symbol, name, market_value_minor,
                    cost_basis_minor, realized_profit_minor, asset_class
             FROM investment_positions ORDER BY asset_class, symbol",
        )
        .map_err(|_| DatabaseError::Read)?;
    let rows = statement
        .query_map([], |row| {
            Ok(InvestmentPosition {
                id: row.get(0)?,
                account_id: row.get(1)?,
                symbol: row.get(2)?,
                name: row.get(3)?,
                market_value: from_minor(row.get(4)?),
                cost_basis: from_minor(row.get(5)?),
                realized_profit: from_minor(row.get(6)?),
                asset_class: row.get(7)?,
            })
        })
        .map_err(|_| DatabaseError::Read)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|_| DatabaseError::Read)
}

fn query_transactions(connection: &Connection) -> Result<Vec<FinancialTransaction>, DatabaseError> {
    let mut statement = connection
        .prepare(
            "SELECT t.id, t.occurred_on, t.kind, t.amount_minor, c.name,
                    t.account_id, t.target_account_id, t.note
             FROM transactions t
             LEFT JOIN categories c ON c.id = t.category_id
             WHERE t.deleted_at IS NULL ORDER BY t.occurred_on DESC, t.created_at DESC",
        )
        .map_err(|_| DatabaseError::Read)?;
    let rows = statement
        .query_map([], |row| {
            Ok(FinancialTransaction {
                id: row.get(0)?,
                date: row.get(1)?,
                kind: row.get(2)?,
                amount: from_minor(row.get(3)?),
                category: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                account_id: row.get(5)?,
                target_account_id: row.get(6)?,
                note: row.get(7)?,
            })
        })
        .map_err(|_| DatabaseError::Read)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|_| DatabaseError::Read)
}

fn validate_state(state: &WealthState) -> Result<(), DatabaseError> {
    let valid_kind = |kind: &str| matches!(kind, "income" | "expense" | "transfer");
    if state
        .transactions
        .iter()
        .any(|item| !valid_kind(&item.kind) || item.amount < 0.0)
    {
        return Err(DatabaseError::Write);
    }
    if state.transactions.iter().any(|item| {
        item.kind == "transfer"
            && (item.target_account_id.is_none()
                || item.target_account_id.as_ref() == Some(&item.account_id))
    }) {
        return Err(DatabaseError::Write);
    }
    Ok(())
}

fn default_targets() -> MonthlyTargets {
    MonthlyTargets {
        month: "2026-07".into(),
        ..MonthlyTargets::default()
    }
}

fn to_minor(value: f64) -> i64 {
    (value * 100.0).round() as i64
}

fn from_minor(value: i64) -> f64 {
    value as f64 / 100.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn sample_state() -> WealthState {
        WealthState {
            accounts: vec![Account {
                id: "bank".into(),
                name: "银行卡".into(),
                kind: "bank".into(),
                balance: 12345.67,
                updated_at: "2026-07-01".into(),
            }],
            properties: vec![PropertyAsset {
                id: "home".into(),
                name: "自住房".into(),
                valuation: 2_000_000.0,
                updated_at: "2026-07-01".into(),
            }],
            liabilities: vec![Liability {
                id: "mortgage".into(),
                name: "房贷".into(),
                balance: 1_000_000.0,
                property_id: Some("home".into()),
                updated_at: "2026-07-01".into(),
            }],
            positions: vec![],
            transactions: vec![FinancialTransaction {
                id: "salary".into(),
                date: "2026-07-05".into(),
                kind: "income".into(),
                amount: 20000.0,
                category: "工资".into(),
                account_id: "bank".into(),
                target_account_id: None,
                note: None,
            }],
            targets: MonthlyTargets {
                month: "2026-07".into(),
                net_worth_growth: 50000.0,
                net_cash_flow: 20000.0,
                investment_return: 10000.0,
            },
            opening_net_worth: 1_000_000.0,
        }
    }

    #[test]
    fn creates_encrypted_schema() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("wealth.db");
        let connection = open_encrypted(&path, &[7_u8; 32]).unwrap();
        let migration_count: i64 = connection
            .query_row("SELECT count(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(migration_count, 2);
    }

    #[test]
    fn round_trips_real_wealth_data() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("wealth.db");
        let mut connection = open_encrypted(&path, &[8_u8; 32]).unwrap();
        let expected = sample_state();
        save_wealth_state(&mut connection, &expected).unwrap();
        let actual = load_wealth_state(&connection).unwrap();
        assert_eq!(actual, expected);
    }

    #[test]
    fn rejects_transfer_to_same_account() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("wealth.db");
        let mut connection = open_encrypted(&path, &[9_u8; 32]).unwrap();
        let mut state = sample_state();
        state.transactions.push(FinancialTransaction {
            id: "bad-transfer".into(),
            date: "2026-07-06".into(),
            kind: "transfer".into(),
            amount: 100.0,
            category: "内部转账".into(),
            account_id: "bank".into(),
            target_account_id: Some("bank".into()),
            note: None,
        });
        assert!(save_wealth_state(&mut connection, &state).is_err());
    }
}
