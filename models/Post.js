const mongoose = require("mongoose");

const postSchema = new mongoose.Schema(
  {
    authorUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    authorBusiness: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: true,
    },

    title: {
      type: String,
      trim: true,
      maxlength: 120,
    },

    content: {
      type: String,
      required: true,
      maxlength: 5000,
    },

    postType: {
      type: String,
      enum: [
        "INSIGHT",
        "CASE_STUDY",
        "WARNING",
        "QUESTION",
        "RESOURCE",
        "TIP",
        "OPPORTUNITY",
      ],
      required: true,
    },

    // tags: [{
    //   type: String,
    //   lowercase: true,
    //   trim: true
    // }],

    // visibility: {
    //   type: String,
    //   enum: ["PUBLIC", "COMMUNITY", "PRIVATE"],
    //   default: "PUBLIC"
    // },

    upvotes: {
      type: Number,
      default: 0,
    },

    downvotes: {
      type: Number,
      default: 0,
    },
    images: [{ type: String }],
    reputationScore: {
      type: Number,
      default: 0,
    },

    // isFlagged: {
    //   type: Boolean,
    //   default: false
    // },

    // flagReason: {
    //   type: String
    // },

    // status: {
    //   type: String,
    //   enum: ["ACTIVE", "HIDDEN", "REMOVED"],
    //   default: "ACTIVE"
    // },

    // deletedAt: {
    //   type: Date
    // }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Post", postSchema);
