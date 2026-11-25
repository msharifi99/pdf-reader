//! One serialisable error type for every command. Messages are calm and user-facing.
use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize, specta::Type, PartialEq, Eq)]
pub enum ErrorCode {
    NotFound,
    Unsupported,
    Corrupt,
    Io,
    Db,
    PasswordRequired,
    Invalid,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct Error {
    pub code: ErrorCode,
    pub message: String,
}

pub type Res<T> = Result<T, Error>;

impl Error {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }
    pub fn not_found(what: &str) -> Self {
        Self::new(ErrorCode::NotFound, format!("Couldn't find {what}."))
    }
    pub fn invalid(msg: impl Into<String>) -> Self {
        Self::new(ErrorCode::Invalid, msg)
    }
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}
impl std::error::Error for Error {}

impl From<rusqlite::Error> for Error {
    fn from(e: rusqlite::Error) -> Self {
        match e {
            rusqlite::Error::QueryReturnedNoRows => Error::not_found("that item"),
            e => Error::new(ErrorCode::Db, format!("The library database had a problem ({e}).")),
        }
    }
}
impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        if e.kind() == std::io::ErrorKind::NotFound {
            Error::new(ErrorCode::NotFound, "That file or folder is no longer there.")
        } else {
            Error::new(ErrorCode::Io, format!("Couldn't read or write the file ({e})."))
        }
    }
}
impl From<zip::result::ZipError> for Error {
    fn from(e: zip::result::ZipError) -> Self {
        Error::new(ErrorCode::Corrupt, format!("That archive looks damaged ({e})."))
    }
}
impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self {
        Error::new(ErrorCode::Corrupt, format!("Some stored data was unreadable ({e})."))
    }
}
