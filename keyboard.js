const { Keyboard } = require("grammy");

const userMenu = new Keyboard()
    .text("🎁 Daily Reward").text("📺 Watch Video")
    .row().text("👥 My Stats").resized();

const adminMenu = new Keyboard()
    .text("🎁 Daily Reward").text("📺 Watch Video")
    .row().text("📊 Global Stats").text("📢 Promotion")
    .row().text("➕ Add Admin").text("📜 Admin List")
    .row().text("👥 All Users").text("🎥 All Videos")
    .row().text("📢 Manage Channels").resized();

module.exports = { userMenu, adminMenu };