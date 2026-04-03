require('dotenv').config();

module.exports = {
    BOT_TOKEN: process.env.BOT_TOKEN,
    MONGO_URI: process.env.MONGO_URI,
    MAIN_ADMIN_ID: parseInt(process.env.MAIN_ADMIN_ID),
    ADMIN_PASS: process.env.ADMIN_PASS
};
