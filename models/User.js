const mongoose = require("mongoose");
const { type } = require("os");
const passportLocalMongoose = require("passport-local-mongoose");
const { ref } = require("process");

const userSchema = new mongoose.Schema({
  username: String,
  email: { type: String, unique: true },
  googleId: { type: String, sparse: true }, 
  image: { 
    type: String, 
    default: "https://upload.wikimedia.org/wikipedia/commons/2/2c/Default_pfp.svg" 
  },
  reputationScore: {
    type: Number,
    min: -100,
    max: 100,
  },
  posts: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
    },
  ],
  businesses: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
    },
  ],
  sentRequests: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  ],
  pendingRequests: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  ],
  connections: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  ],
  createdAt: { type: Date, default: Date.now },
});

userSchema.plugin(passportLocalMongoose, {
  usernameField: "email",
  usernameLowerCase: true,
  usernameUnique: true,
});

module.exports = mongoose.model("User", userSchema);
