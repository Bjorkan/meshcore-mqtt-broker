use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Process-local observer ownership shared by authentication and routing.
/// The newest authenticated connection owns a public key; stale disconnects
/// cannot release the replacement owner.
#[derive(Clone, Default)]
pub struct ObserverOwnership {
    owners: Arc<Mutex<HashMap<String, String>>>,
}

impl ObserverOwnership {
    pub(super) fn set(&self, public_key: &str, connection_id: &str) {
        self.owners
            .lock()
            .expect("observer ownership lock")
            .insert(public_key.to_owned(), connection_id.to_owned());
    }

    pub fn is_owner(&self, public_key: &str, connection_id: &str) -> bool {
        self.owners
            .lock()
            .expect("observer ownership lock")
            .get(public_key)
            .is_some_and(|owner| owner == connection_id)
    }

    pub(super) fn release(&self, public_key: &str, connection_id: &str) {
        let mut owners = self.owners.lock().expect("observer ownership lock");
        if owners
            .get(public_key)
            .is_some_and(|owner| owner == connection_id)
        {
            owners.remove(public_key);
        }
    }
}
