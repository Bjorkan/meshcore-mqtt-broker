use std::collections::{HashMap, VecDeque};
use std::hash::Hash;

pub(crate) struct LruEntry<K, V> {
    pub(crate) key: K,
    pub(crate) value: V,
    generation: u64,
}

struct Versioned<V> {
    value: V,
    generation: u64,
}

pub(crate) struct LruMap<K, V> {
    entries: HashMap<K, Versioned<V>>,
    order: VecDeque<(K, u64)>,
    next_generation: u64,
}

impl<K, V> Default for LruMap<K, V> {
    fn default() -> Self {
        Self {
            entries: HashMap::new(),
            order: VecDeque::new(),
            next_generation: 0,
        }
    }
}

impl<K: Clone + Eq + Hash, V> LruMap<K, V> {
    pub(crate) fn len(&self) -> usize {
        self.entries.len()
    }

    pub(crate) fn contains_key<Q>(&self, key: &Q) -> bool
    where
        K: std::borrow::Borrow<Q>,
        Q: Eq + Hash + ?Sized,
    {
        self.entries.contains_key(key)
    }

    pub(crate) fn get<Q>(&self, key: &Q) -> Option<&V>
    where
        K: std::borrow::Borrow<Q>,
        Q: Eq + Hash + ?Sized,
    {
        self.entries.get(key).map(|entry| &entry.value)
    }

    pub(crate) fn insert(&mut self, key: K, value: V) -> Option<V> {
        self.next_generation = self.next_generation.wrapping_add(1);
        let generation = self.next_generation;
        self.order.push_back((key.clone(), generation));
        let previous = self
            .entries
            .insert(key, Versioned { value, generation })
            .map(|entry| entry.value);
        self.compact_if_needed();
        previous
    }

    pub(crate) fn remove<Q>(&mut self, key: &Q) -> Option<V>
    where
        K: std::borrow::Borrow<Q>,
        Q: Eq + Hash + ?Sized,
    {
        self.entries.remove(key).map(|entry| entry.value)
    }

    pub(crate) fn pop_lru(&mut self) -> Option<LruEntry<K, V>> {
        while let Some((key, generation)) = self.order.pop_front() {
            if self
                .entries
                .get(&key)
                .is_some_and(|entry| entry.generation == generation)
            {
                let entry = self.entries.remove(&key).expect("entry checked above");
                return Some(LruEntry {
                    key,
                    value: entry.value,
                    generation,
                });
            }
        }
        None
    }

    pub(crate) fn restore_lru(&mut self, entry: LruEntry<K, V>) {
        self.order.push_front((entry.key.clone(), entry.generation));
        self.entries.insert(
            entry.key,
            Versioned {
                value: entry.value,
                generation: entry.generation,
            },
        );
    }

    pub(crate) fn iter(&self) -> impl Iterator<Item = (&K, &V)> {
        self.entries.iter().map(|(key, entry)| (key, &entry.value))
    }

    pub(crate) fn values(&self) -> impl Iterator<Item = &V> {
        self.entries.values().map(|entry| &entry.value)
    }

    #[cfg(test)]
    pub(crate) fn keys(&self) -> impl Iterator<Item = &K> {
        self.entries.keys()
    }

    fn compact_if_needed(&mut self) {
        let maximum_index = self.entries.len().saturating_mul(4).saturating_add(64);
        if self.order.len() <= maximum_index {
            return;
        }
        let mut current = self
            .entries
            .iter()
            .map(|(key, entry)| (key.clone(), entry.generation))
            .collect::<Vec<_>>();
        current.sort_by_key(|(_, generation)| *generation);
        self.order = current.into();
    }

    #[cfg(test)]
    fn index_len(&self) -> usize {
        self.order.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn capacity_and_ttl_storm_operations_stay_within_debug_budget() {
        const CAPACITY: usize = 10_000;
        let started = Instant::now();
        let mut map = LruMap::default();
        for value in 0..100_000_u64 {
            map.insert(value % 20_000, value);
            if map.len() > CAPACITY {
                map.pop_lru().unwrap();
            }
        }
        assert_eq!(map.len(), CAPACITY);
        assert!(map.index_len() <= CAPACITY * 4 + 64);

        let keys = map.keys().copied().collect::<Vec<_>>();
        for key in keys {
            map.remove(&key);
        }
        assert_eq!(map.len(), 0);
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "100k capacity operations plus a 10k TTL storm exceeded 5 s"
        );
    }

    #[test]
    fn refresh_moves_a_key_to_the_back_and_restore_keeps_the_front() {
        let mut map = LruMap::default();
        map.insert("a", 1);
        map.insert("b", 2);
        map.insert("a", 3);
        assert_eq!(map.pop_lru().unwrap().key, "b");
        let oldest = map.pop_lru().unwrap();
        map.restore_lru(oldest);
        map.insert("c", 4);
        assert_eq!(map.pop_lru().unwrap().key, "a");
    }
}
