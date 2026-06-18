/**
 * MODULE 5 — Custom LRU Tracker
 *
 * Tracks access order of cache keys using a doubly-linked list + hash map.
 * O(1) touch, O(1) evict.
 *
 * When Redis is at MAX_CACHE_KEYS capacity:
 *   → evict() returns the LRU key to delete from Redis
 *   → touch(id) moves a key to "most recently used"
 *   → remove(id) removes a key (used on purge)
 */

class Node {
  constructor(key) {
    this.key = key;
    this.prev = null;
    this.next = null;
  }
}

class LRUTracker {
  constructor(maxSize) {
    this.maxSize = maxSize;
    this.map = new Map();          // key → Node

    // Sentinel head (LRU end) and tail (MRU end)
    this.head = new Node('__HEAD__');
    this.tail = new Node('__TAIL__');
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  // Move node to the MRU end (just before tail)
  _moveToTail(node) {
    this._remove(node);
    this._insertBeforeTail(node);
  }

  _remove(node) {
    node.prev.next = node.next;
    node.next.prev = node.prev;
  }

  _insertBeforeTail(node) {
    node.prev = this.tail.prev;
    node.next = this.tail;
    this.tail.prev.next = node;
    this.tail.prev = node;
  }

  /**
   * Record a cache access. Creates the key entry if new, or moves it to MRU.
   */
  touch(key) {
    if (this.map.has(key)) {
      this._moveToTail(this.map.get(key));
    } else {
      const node = new Node(key);
      this.map.set(key, node);
      this._insertBeforeTail(node);
    }
  }

  /**
   * Evict the least recently used key. Returns the key string (or null if empty).
   */
  evict() {
    const lruNode = this.head.next;
    if (lruNode === this.tail) return null;   // nothing to evict

    this._remove(lruNode);
    this.map.delete(lruNode.key);
    return lruNode.key;
  }

  /**
   * Remove a specific key (on purge or manual delete).
   */
  remove(key) {
    if (!this.map.has(key)) return;
    const node = this.map.get(key);
    this._remove(node);
    this.map.delete(key);
  }

  /**
   * Return the current LRU → MRU order as an array (for /metrics inspection).
   */
  getQueue() {
    const queue = [];
    let cur = this.head.next;
    while (cur !== this.tail) {
      queue.push(cur.key);
      cur = cur.next;
    }
    return queue;   // index 0 = LRU, last = MRU
  }

  get size() {
    return this.map.size;
  }
}

module.exports = { LRUTracker };
