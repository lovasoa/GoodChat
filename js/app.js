/* JS */

// PouchDB.debug.enable('*');
class DB extends PouchDB {
 constructor() {
  const name = "chat"
  super(name);
  this.name = name;
  this.remote = 'http://localhost:5984/chat';
 }

 sync() {
  PouchDB.sync(this.name, this.remote, {
   live: true,
   retry: true
  });
 }
}

class Message {
 constructor({
  date,
  author,
  text,
  likedBy,
  _rev,
  _id
 }) {
  var date_obj = new Date(date);
  this.type = "message";
  this.date = date_obj;
  this.author = author || "Anonymous";
  this.text = text;

  // Private property this._likedBy
  const likedBySet = new Set(likedBy || []);
  Object.defineProperty(this, '_likedBy', {
   value: likedBySet
  });

  this._id = 'message$' + this.date.toISOString() + '$' + this.author;
  if (_id !== this._id) console.error("Message created with invalid data");
  this._rev = _rev;
 }

 /**
  * Add the given user to the people who like this message
  **/
 like(username) {
  if (!username) throw new Error("You must be logged in to like messages");
  this._likedBy.add(username);
 }

 /**
  * Get the number of likes of the message
  **/
 get likes() {
  return this._likedBy.size;
 }

 /**
  * Converts to a simple JSON document to use in the database
  */
 toJSON() {
  return Object.assign({}, this, {
   'date': this.date.toISOString(),
   'likedBy': Array.from(this._likedBy)
  });
 }


 /**
  * Save the message to the database
  */
 save(db) {
  db.put(this.toJSON())
   .then(e => this._rev = e.rev)
   .catch(e => console.error(e));
 }

 /**
  * Deletes the message
  **/
 remove(db) {
  this._deleted = true;
  this.save(db);
 }

 /**
  * Updates the message with new data
  **/
 update(db, {
  likedBy,
  _rev,
  _conflicts = []
 }) {
  // Only likedBy is allowed to be updated
  for (let u of likedBy) {
   this.like(u);
  }
  if (_conflicts.length > 0) {
   const likes = this.likes;
   this.resolveConflicts(db, _conflicts)
    .then(() => this.likes !== likes && this.save(db));
  }
  this._rev = _rev; // Update our revision
 }

 /**
  * Solve conflicts between messages
  * (by merging likedBy between different messages)
  **/
 resolveConflicts(db, conflicts) {
  const docPromises = conflicts.map(_rev => db.get(this._id, {
   rev: _rev
  }));
  return Promise.all(docPromises).then(docs => docs.forEach(doc => this.update(db, doc)));
 }

 /**
  * Create a message from the current user
  **/
 static create(username, text) {
  return new Message({
   date: Date.now(),
   author: username,
   text: text
  });
 }
}

class Messages {
 constructor() {
  this.list = [];
  this.username = "Anonymous " + Math.round(Math.random() * 1000);
  this.db = new DB;
  this.db.sync();
  this.fetchAll();
  this.db.changes({
   since: 'now',
   live: 'true',
   include_docs: true,
   conflicts: true
  }).on('change', e => this.handleEvent(e))
 }

 setUserName(u) {
  this.username = u;
 }

 find(msg) {
  const res = this.list.find(m => m._id === msg._id);
  if (res === undefined) throw new Error("No such message");
  return res;
 }

 handleEvent(e) {
  if (!e || !e.doc || e.doc.type !== 'message') return;
  if (e.deleted) {
   this.removeFromList(e.id);
  } else {
   this.addToList(e.doc);
  }
  // Refresh the vue
  app.messages = this.toJSON();
 }

 createMessage(txt) {
  var msg = Message.create(this.username, txt);
  msg.save(this.db);
 }

 /**
  * Takes a JSON representation of a message and insert it
  * @param msg {Object} the message data
  **/
 addToList(doc) {
  // Find the position to insert the message
  const i = this.list.findIndex(o => o._id >= doc._id);
  if (i === -1) {
   // All existing messages are older than the new one
   this.list.push(new Message(doc));
  } else if (this.list[i]._id !== doc._id) {
   // There are messages newer than the new one
   this.list.splice(i, 0, new Message(doc));
  } else {
   // The message exists and was updated
   let msg = this.list[i];
   msg.update(this.db, doc);
  }
 }

 removeFromList(msgId) {
  this.list = this.list.filter(o => o._id !== msgId);
 }

 fetchAll() {
  this.db.allDocs({
   include_docs: true,
   conflicts: true,
   startkey: 'message',
   endkey: 'message\uffff'
  }).then(o => o.rows.forEach(e => this.handleEvent(e)));
 }

 deleteMessage(msg) {
  this.find(msg).remove(this.db);
 }

 likeMessage(msgJSON) {
  let msg = this.find(msgJSON);
  msg.like(this.username);
  msg.save(this.db);
 }

 toJSON() {
  return this.list.map(o => o.toJSON());
 }
}
const messages = new Messages;

var app = new Vue({
 el: '#app',
 data: {
  messages: [],
  current_text: "",
  show_options: false,
 },
 methods: {
  send() {
   messages.createMessage(this.current_text);
   this.current_text = "";
  },
  deleteMessage(msg) {
   messages.deleteMessage(msg);
  },
  likeMessage(msg) {
   messages.likeMessage(msg);
  },
  setUserName: e => messages.setUserName(e.target.value),
  getUserName: () => messages.username,
 },
 updated(e) {
  var dom_el = document.querySelector(".messages");
  dom_el.scrollTop = dom_el.scrollHeight;
 }
});
