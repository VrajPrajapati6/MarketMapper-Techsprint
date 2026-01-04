const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const User = require("./User");
const businessSchema = new Schema({
    owner: { type: Schema.Types.ObjectId, ref: 'User' },
    name: { type: String, required: true },
    category: { type: String, required: true },
    description: String,
    location: {
        address: String,
        lat: Number,
        lng: Number
    },
    stats: {
        employeeCount: Number,
        revenueRange: String,
        yearsInBusiness: Number
    },
    resources: {
        pos: {type: String},
        hasDelivery: { type: String},
        // capacityLevel: { type: String} 
    },
}, { timestamps: true });

module.exports = mongoose.model('Business', businessSchema);