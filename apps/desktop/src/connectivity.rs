use reqwest::StatusCode;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectivityState {
    Online,
    Offline,
}

impl ConnectivityState {
    pub fn from_status(result: Result<StatusCode, ()>) -> Self {
        match result {
            Ok(status) if status.is_success() => Self::Online,
            Ok(_) | Err(_) => Self::Offline,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::ConnectivityState;
    use reqwest::StatusCode;

    #[test]
    fn treats_success_status_as_online() {
        assert_eq!(
            ConnectivityState::from_status(Ok(StatusCode::OK)),
            ConnectivityState::Online
        );
    }

    #[test]
    fn treats_non_success_status_as_offline() {
        assert_eq!(
            ConnectivityState::from_status(Ok(StatusCode::SERVICE_UNAVAILABLE)),
            ConnectivityState::Offline
        );
    }

    #[test]
    fn treats_request_failure_as_offline() {
        assert_eq!(
            ConnectivityState::from_status(Err(())),
            ConnectivityState::Offline
        );
    }
}
