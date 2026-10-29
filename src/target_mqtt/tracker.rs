use super::TargetError;
use std::collections::VecDeque;

type WriteCompletion = tokio::sync::oneshot::Sender<Result<(), TargetError>>;

/// Tracks pending QoS 0 write completions in submission order.
///
/// rumqttc does not tag `Outgoing::Publish` events with the originating
/// publish, so the eventloop completes the front entry when a publish is
/// actually written. Correct association therefore relies on strict FIFO
/// alignment between callback registration, channel submission and event
/// delivery: `RumqttTarget::publish` serializes submissions and only ever
/// removes the entry whose channel submission failed.
pub(super) struct WriteTracker {
    queue: VecDeque<(u64, WriteCompletion)>,
}

impl WriteTracker {
    pub(super) fn new() -> Self {
        Self {
            queue: VecDeque::new(),
        }
    }

    pub(super) fn submit(&mut self, id: u64, complete: WriteCompletion) {
        self.queue.push_back((id, complete));
    }

    /// Remove the entry whose channel submission failed. With serialized
    /// submission this is always the front entry; removal by id keeps the
    /// pairing correct even if that invariant is ever relaxed.
    pub(super) fn remove(&mut self, id: u64) {
        self.queue.retain(|(entry, _)| *entry != id);
    }

    pub(super) fn pop_front(&mut self) -> Option<(u64, WriteCompletion)> {
        self.queue.pop_front()
    }

    pub(super) fn drain(&mut self) -> Vec<(u64, WriteCompletion)> {
        self.queue.drain(..).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_tracker_pairs_events_with_submissions_in_fifo_order() {
        let mut tracker = WriteTracker::new();
        let (a, _a) = tokio::sync::oneshot::channel();
        let (b, _b) = tokio::sync::oneshot::channel();
        tracker.submit(1, a);
        tracker.submit(2, b);
        assert_eq!(tracker.pop_front().unwrap().0, 1);
        assert_eq!(tracker.pop_front().unwrap().0, 2);
        assert!(tracker.pop_front().is_none());
        assert!(tracker.drain().is_empty());
    }

    #[test]
    fn write_tracker_failed_submission_removal_keeps_pairing() {
        let mut tracker = WriteTracker::new();
        let (a, _a) = tokio::sync::oneshot::channel();
        let (b, _b) = tokio::sync::oneshot::channel();
        let (c, _c) = tokio::sync::oneshot::channel();
        tracker.submit(1, a);
        tracker.submit(2, b);
        tracker.submit(3, c);
        // Submission 2 failed and never entered the channel: remove it by id
        // so the remaining events still complete the right callbacks.
        tracker.remove(2);
        assert_eq!(tracker.pop_front().unwrap().0, 1);
        assert_eq!(tracker.pop_front().unwrap().0, 3);
        assert!(tracker.pop_front().is_none());
    }

    #[tokio::test]
    async fn write_tracker_abandoned_entry_is_consumed_by_its_own_event() {
        let mut tracker = WriteTracker::new();
        let (a, receiver_a) = tokio::sync::oneshot::channel();
        let (b, receiver_b) = tokio::sync::oneshot::channel();
        tracker.submit(1, a);
        tracker.submit(2, b);
        // A publish timeout abandons the waiting future of submission 1:
        // its receiver is dropped without removing the tracker entry.
        drop(receiver_a);
        // The late Outgoing event for submission 1 pops its own entry; the
        // send fails silently on the dropped receiver and must not steal or
        // complete submission 2.
        let (id, complete) = tracker.pop_front().unwrap();
        assert_eq!(id, 1);
        assert!(complete.send(Ok(())).is_err());
        // Submission 2 completes only through its own event.
        let (id, complete) = tracker.pop_front().unwrap();
        assert_eq!(id, 2);
        complete.send(Ok(())).unwrap();
        assert_eq!(receiver_b.await.unwrap(), Ok(()));
    }
}
