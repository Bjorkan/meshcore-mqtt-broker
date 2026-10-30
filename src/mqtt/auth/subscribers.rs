use crate::config::{Subscriber, SubscriberRole};
use crate::mqtt::errors::{ObserverError, ObserverErrorCode as Code};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use subtle::ConstantTimeEq;

#[derive(Clone, Default)]
pub(super) struct SubscriberConnections {
    connections: Arc<Mutex<HashMap<String, HashSet<String>>>>,
}

impl SubscriberConnections {
    pub(super) fn authenticate(
        &self,
        connection_id: &str,
        username: &str,
        password: &[u8],
        subscriber: &Subscriber,
    ) -> Result<SubscriberRole, ObserverError> {
        let expected = subscriber.password.as_bytes();
        let matches = expected.len() == password.len() && bool::from(expected.ct_eq(password));
        if !matches {
            return Err(ObserverError::new(
                Code::AuthInvalidPassword,
                format!("subscriber {username} authentication failed. invalid password."),
            ));
        }
        let mut state = self.connections.lock().expect("auth state lock");
        let connections = state.entry(username.to_owned()).or_default();
        if !connections.contains(connection_id) && connections.len() >= subscriber.max_connections {
            return Err(ObserverError::new(
                Code::SubscriberConnectionLimit,
                format!(
                    "subscriber connection limit exceeded for {username} ({}/{})",
                    connections.len(),
                    subscriber.max_connections
                ),
            ));
        }
        connections.insert(connection_id.to_owned());
        Ok(subscriber.role)
    }

    pub(super) fn release(&self, connection_id: &str, username: &str) {
        let mut state = self.connections.lock().expect("auth state lock");
        if let Some(connections) = state.get_mut(username) {
            connections.remove(connection_id);
            if connections.is_empty() {
                state.remove(username);
            }
        }
    }
}
