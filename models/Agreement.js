const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const agreementSchema = new Schema(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },
    amount: { type: Number, required: true },
    deadline: { type: Date, required: true },
    paymentTerms: { type: String, default: "Net 30" },
    sender: { type: Schema.Types.ObjectId, ref: "User" },
    receiver: { type: Schema.Types.ObjectId, ref: "User" },
    status: {
      type: String,
      enum: ["Pending", "Active", "Completed", "Declined", "Disputed"],
      default: "Pending",
    },
    disputeReason: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model("Agreement", agreementSchema);
