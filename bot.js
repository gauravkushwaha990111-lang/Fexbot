const { Bot, InputFile, InlineKeyboard } = require("grammy");
const mongoose = require('mongoose');
const express = require('express');
const { User, Video, Channel } = require('./database');
const { BOT_TOKEN, MONGO_URI, MAIN_ADMIN_ID, ADMIN_PASS } = require('./config');
const { userMenu, adminMenu } = require('./keyboard');

const app = express();
const bot = new Bot(BOT_TOKEN);

mongoose.connect(MONGO_URI).then(async () => {
    console.log("Database Connected!");

    const chCount = await Channel.countDocuments();
    if (chCount === 0) {
        const defaultChannels = ["@devflins", "@flinsbots", "@fexh4b"];
        for (let ch of defaultChannels) {
            await Channel.create({ username: ch });
        }
    }

    bot.api.setMyCommands([
        { command: "start", description: "Start the bot" },
        { command: "find", description: "Search User Details (Admin)" },
        { command: "add", description: "Add Admin (Main Admin)" },
        { command: "send", description: "Broadcast message (Admin)" },
        { command: "addcredit", description: "Add User Credits (Admin)" }
    ]).catch(e => console.log("Failed to set commands:", e));
}).catch(err => {
    console.error("Database connection failed:", err.message);
    console.error("Hint: Make sure your MongoDB IP Access List is set to 'Allow Access From Anywhere' (0.0.0.0/0).");
});
// --- GLOBAL REACTION MIDDLEWARE ---
bot.use(async (ctx, next) => {
    if (!ctx.from) return next();

    const user = await User.findOne({ userId: ctx.from.id });
    if (!user || (!user.isAdmin && !user.isMainAdmin)) {
        if ((ctx.message || ctx.callbackQuery) && (!ctx.callbackQuery || ctx.callbackQuery.data === 'check_sub')) {
            const channels = await Channel.find();
            if (channels.length > 0) {
                let notJoined = [];
                for (let ch of channels) {
                    try {
                        const member = await ctx.api.getChatMember(ch.username, ctx.from.id);
                        if (['left', 'kicked'].includes(member.status)) notJoined.push(ch.username);
                    } catch (e) {
                        notJoined.push(ch.username);
                    }
                }

                if (notJoined.length > 0) {
                    if (ctx.callbackQuery && ctx.callbackQuery.data === "check_sub") {
                        return ctx.answerCallbackQuery({ text: "❌ You have not joined all channels yet!", show_alert: true });
                    }
                    const keyboard = new InlineKeyboard();
                    notJoined.forEach(ch => keyboard.url(`Join ${ch}`, `https://t.me/${ch.replace('@', '')}`).row());
                    keyboard.text("✅ I have joined", "check_sub");

                    return ctx.reply("⛔️ *Access Denied!*\n\nYou must join all our official channels to use this bot.\nIf you leave any of them, you will lose access.", {
                        reply_markup: keyboard,
                        parse_mode: "Markdown"
                    });
                } else if (ctx.callbackQuery && ctx.callbackQuery.data === "check_sub") {
                    await ctx.answerCallbackQuery({ text: "✅ Thank you for joining! You can now use the bot.", show_alert: true });
                    await ctx.deleteMessage().catch(e => {});
                    return;
                }
            }
        }
    }

    if (ctx.message && ctx.message.text) {
        try {
            const emojis = ["❤", "🔥", "👀", "🕊️"];
            await ctx.react(emojis[Math.floor(Math.random() * emojis.length)]);
        } catch (e) { }
    }
    return next();
});

// --- CONVERSATIONAL STATE MIDDLEWARE ---
bot.use(async (ctx, next) => {
    if (!ctx.from) return next();
    const user = await User.findOne({ userId: ctx.from.id });
    if (!user) return next();

    // Broadcast logic
    if (user.botState === 'awaiting_promotion_message' && ctx.message) {
        user.botState = '';
        await user.save();

        const all = await User.find();
        let count = 0;
        const statusMsg = await ctx.reply("⏳ Broadcasting... Please do not send any messages until it is completed.");
        for (let u of all) {
            try {
                await ctx.api.copyMessage(u.userId, ctx.chat.id, ctx.message.message_id);
                count++;
            } catch (e) { }
        }
        return ctx.reply(`📢 Promotion successfully sent to ${count} users.`);
    }

    return next();
});

// --- START COMMAND & REFERRAL LOGIC ---
bot.command("start", async (ctx) => {
    const payload = ctx.match; // Referral ID if any
    let user = await User.findOne({ userId: ctx.from.id });

    if (!user) {
        user = new User({
            userId: ctx.from.id,
            userName: ctx.from.first_name,
            telegramUsername: ctx.from.username,
            isMainAdmin: ctx.from.id === MAIN_ADMIN_ID
        });

        // Referral logic
        if (payload && payload !== ctx.from.id.toString()) {
            const referrer = await User.findOne({ userId: parseInt(payload) });
            if (referrer) {
                referrer.referCount += 1;
                await referrer.save();
                await bot.api.sendMessage(referrer.userId, `🎉 New Referral! ${ctx.from.first_name} has joined.`);
            }
        }
        await user.save();
        await bot.api.sendMessage(MAIN_ADMIN_ID, `🔔 New User Joined: ${ctx.from.first_name} (ID: ${ctx.from.id})`);
    }

    const menu = (user.isAdmin || user.isMainAdmin) ? adminMenu : userMenu;
    await ctx.reply(`Hello ${ctx.from.first_name}! Welcome to our bot.`, { reply_markup: menu });
});

// --- ADMIN: VIDEO UPLOAD (Direct or Forward) ---
bot.on(":video", async (ctx) => {
    const user = await User.findOne({ userId: ctx.from.id });
    if (!user || (!user.isAdmin && !user.isMainAdmin)) return;

    try {
        await Video.create({
            fileId: ctx.message.video.file_id,
            uniqueId: ctx.message.video.file_unique_id
        });
        await ctx.reply("✅ Video saved to the database!");
    } catch (e) {
        await ctx.reply("❌ Error: This video is already in the database.");
    }
});

// --- USER: WATCH VIDEO & AUTO-REACTION ---
bot.hears("📺 Watch Video", async (ctx) => {
    const user = await User.findOne({ userId: ctx.from.id });
    if (!user) return ctx.reply("Please start the bot first using /start");

    const isAdmin = user.isAdmin || user.isMainAdmin;

    if (!isAdmin) {
        if (user.credits <= 0) {
            return ctx.reply("❌ You do not have enough credits! Click on '🎁 Daily Reward' to earn new credits.");
        }

        if (user.lastWatchedVideoTime) {
            const diff = Date.now() - user.lastWatchedVideoTime.getTime();
            if (diff < 15000) {
                const waitSecs = Math.ceil((15000 - diff) / 1000);
                return ctx.reply(`⏳ Please wait ${waitSecs} seconds before watching the next video.`);
            }
        }
    }

    const watchedIds = user.watchedVideos || [];
    const video = await Video.aggregate([
        { $match: { _id: { $nin: watchedIds } } },
        { $sort: { _id: 1 } },
        { $limit: 1 }
    ]);

    if (video.length === 0) {
        return ctx.reply("You have watched all available videos. Please wait for new videos to be uploaded!");
    }

    const vId = video[0]._id;
    const incQuery = { videosWatched: 1 };
    if (!isAdmin) incQuery.credits = -1;

    const updateQuery = {
        $inc: incQuery,
        $push: { watchedVideos: vId }
    };
    if (!isAdmin) updateQuery.$set = { lastWatchedVideoTime: new Date() };

    await User.findOneAndUpdate({ userId: ctx.from.id }, updateQuery);

    const totalVideos = await Video.countDocuments();
    const remaining = totalVideos - (watchedIds.length + 1);

    if (remaining === 10) {
        const admins = await User.find({ $or: [{ isAdmin: true }, { isMainAdmin: true }] });
        const textMsg = `⚠️ *Alert:* User [${user.userName || user.userId}](tg://user?id=${user.userId}) only has *10 new videos* left to watch!\nPlease upload new videos soon.`;
        for (const admin of admins) {
            try { await bot.api.sendMessage(admin.userId, textMsg, { parse_mode: "Markdown" }); } catch (e) { }
        }
    }

    const sentMsg = await ctx.replyWithVideo(video[0].fileId, { message_effect_id: "5104841245755180586" });
    try { await bot.api.setMessageReaction(ctx.chat.id, sentMsg.message_id, [{ type: "emoji", emoji: "🔥" }]); } catch (e) { }
});

// --- DAILY REWARD (24H CHECK) ---
bot.hears("🎁 Daily Reward", async (ctx) => {
    const user = await User.findOne({ userId: ctx.from.id });
    const now = new Date();

    if (user.lastClaim && now - user.lastClaim < 24 * 60 * 60 * 1000) {
        return ctx.reply("⏳ Today's reward has already been claimed. Come back tomorrow!");
    }

    user.lastClaim = now;
    user.credits += 2;
    await user.save();
    await ctx.reply("✅ Your daily reward is unlocked! 2 free credits have been added to your account.");
});

// --- USER/ADMIN STATS ---
bot.hears("👥 My Stats", async (ctx) => {
    const user = await User.findOne({ userId: ctx.from.id });
    const refLink = `https://t.me/${bot.botInfo.username}?start=${ctx.from.id}`;
    await ctx.reply(`📊 *Your Stats:*\n\n📺 Videos Watched: ${user.videosWatched}\n👥 Total Referrals: ${user.referCount}\n\n🔗 *Ref Link:* \`${refLink}\``, { parse_mode: "Markdown" });
});

bot.hears("📊 Global Stats", async (ctx) => {
    if (ctx.from.id !== MAIN_ADMIN_ID && !(await User.findOne({ userId: ctx.from.id })).isAdmin) return;
    const totalU = await User.countDocuments();
    const totalV = await Video.countDocuments();
    await ctx.reply(`📈 *Bot Overview:*\n\nTotal Users: ${totalU}\nTotal Videos: ${totalV}`, { parse_mode: "Markdown" });
});

// --- ALL USERS LIST (ADMIN ONLY) ---
bot.hears("👥 All Users", async (ctx) => {
    const user = await User.findOne({ userId: ctx.from.id });
    if (!user || (!user.isAdmin && !user.isMainAdmin)) return;

    const allUsers = await User.find();
    let text = `👥 *Total Users:* ${allUsers.length}\n\n`;
    allUsers.forEach((u, index) => {
        const username = u.telegramUsername ? `@${u.telegramUsername}` : (u.userName || 'No Name');
        text += `${index + 1}. ID: \`${u.userId}\` | ${username} | Watched: ${u.videosWatched} | Credits: ${u.credits}\n`;
    });

    if (text.length > 4000) {
        await ctx.replyWithDocument(new InputFile(Buffer.from(text, "utf-8"), "users_list.txt"), {
            caption: `👥 Total Users: ${allUsers.length}`
        });
    } else {
        await ctx.reply(text, { parse_mode: "Markdown" });
    }
});

bot.command("find", async (ctx) => {
    const user = await User.findOne({ userId: ctx.from.id });
    if (!user.isAdmin && !user.isMainAdmin) return;

    const target = await User.findOne({ userId: parseInt(ctx.match) });
    if (!target) return ctx.reply("User not found!");

    const username = target.telegramUsername ? `@${target.telegramUsername}` : (target.userName || 'No Name');
    await ctx.reply(`👤 *User Info:*\nID: \`${target.userId}\`\nName: ${username}\nCredits: ${target.credits}\nWatched: ${target.videosWatched}\nRefers: ${target.referCount}\nJoined: ${target.joinedAt.toDateString()}`, { parse_mode: "Markdown" });
});

// --- ADMIN MANAGEMENT ---
bot.command("add", async (ctx) => {
    if (ctx.from.id !== MAIN_ADMIN_ID) return;
    await User.findOneAndUpdate({ userId: ctx.from.id }, { botState: 'awaiting_admin_pass' });
    await ctx.reply("🔒 Please enter the Admin Password:");
});

bot.hears("➕ Add Admin", async (ctx) => {
    if (ctx.from.id !== MAIN_ADMIN_ID) return;
    await User.findOneAndUpdate({ userId: ctx.from.id }, { botState: 'awaiting_admin_pass' });
    await ctx.reply("🔒 Please enter the Admin Password:");
});

bot.hears("📜 Admin List", async (ctx) => {
    const admins = await User.find({ $or: [{ isAdmin: true }, { isMainAdmin: true }] });
    let list = "👑 *Admin List:*\n";
    admins.forEach(a => list += `- \`${a.userId}\` ${a.isMainAdmin ? '(Main)' : ''}\n`);
    await ctx.reply(list, { parse_mode: "Markdown" });
});

// --- PROMOTION (BROADCAST) ---
bot.command("send", async (ctx) => {
    const user = await User.findOne({ userId: ctx.from.id });
    if (!user || (!user.isAdmin && !user.isMainAdmin)) return;

    user.botState = 'awaiting_promotion_message';
    await user.save();
    await ctx.reply("📢 Please send your promotion message, photo, or video that you want to broadcast to everyone:");
});

bot.hears("📢 Promotion", async (ctx) => {
    const user = await User.findOne({ userId: ctx.from.id });
    if (!user || (!user.isAdmin && !user.isMainAdmin)) return;

    user.botState = 'awaiting_promotion_message';
    await user.save();
    await ctx.reply("📢 Please send your promotion message, photo, or video that you want to broadcast to everyone:");
});

// --- MANAGE CREDITS (ADMIN ONLY) ---
bot.command("addcredit", async (ctx) => {
    const user = await User.findOne({ userId: ctx.from.id });
    if (!user || (!user.isAdmin && !user.isMainAdmin)) return;

    const args = ctx.match.split(" ");
    if (args.length !== 2) return ctx.reply("Usage: `/addcredit USER_ID AMOUNT`\nExample: `/addcredit 123456789 5`", { parse_mode: "Markdown" });

    const targetId = parseInt(args[0]);
    const amount = parseInt(args[1]);

    const target = await User.findOneAndUpdate({ userId: targetId }, { $inc: { credits: amount } }, { new: true });
    if (!target) return ctx.reply("User not found!");

    await ctx.reply(`✅ User ${targetId}'s credits have been increased by ${amount}.\nNew Balance: ${target.credits}`);
    try { await bot.api.sendMessage(targetId, `🎁 Admin has added ${amount} credits to your account! New balance: ${target.credits}`); } catch (e) { }
});

// --- MANAGE CHANNELS (ADMIN ONLY) ---
bot.hears("📢 Manage Channels", async (ctx) => {
    const user = await User.findOne({ userId: ctx.from.id });
    if (!user || (!user.isAdmin && !user.isMainAdmin)) return;
    
    const channels = await Channel.find();
    let text = "📢 *Mandatory Channels:*\n\n";
    channels.forEach((ch, idx) => text += `${idx + 1}. ${ch.username}\n`);
    text += "\n*Commands:*\n`/addchannel @username` - Add new channel\n`/delchannel @username` - Remove channel";
    
    await ctx.reply(text, { parse_mode: "Markdown" });
});

bot.command("addchannel", async (ctx) => {
    const user = await User.findOne({ userId: ctx.from.id });
    if (!user || (!user.isAdmin && !user.isMainAdmin)) return;
    
    let username = ctx.match.trim();
    if (!username) return ctx.reply("Usage: `/addchannel @username`", { parse_mode: "Markdown" });
    if (!username.startsWith('@')) username = '@' + username;
    
    try {
        await Channel.create({ username });
        await ctx.reply(`✅ Successfully added ${username} to forced channels list!`);
    } catch (e) {
        await ctx.reply("❌ Error: Channel might already exist.");
    }
});

bot.command("delchannel", async (ctx) => {
    const user = await User.findOne({ userId: ctx.from.id });
    if (!user || (!user.isAdmin && !user.isMainAdmin)) return;

    let username = ctx.match.trim();
    if (!username) return ctx.reply("Usage: `/delchannel @username`", { parse_mode: "Markdown" });
    if (!username.startsWith('@')) username = '@' + username;

    const deleted = await Channel.findOneAndDelete({ username });
    if (deleted) await ctx.reply(`🗑️ Removed ${username} from forced channels list!`);
    else await ctx.reply("❌ Channel not found.");
});

// --- ALL VIDEOS (ADMIN ONLY) ---
bot.hears("🎥 All Videos", async (ctx) => {
    const user = await User.findOne({ userId: ctx.from.id });
    if (!user || (!user.isAdmin && !user.isMainAdmin)) return;

    const vids = await Video.find();
    let text = `🎥 *Total Videos:* ${vids.length}\n\n`;
    vids.forEach((v, i) => {
        text += `${i + 1}. \`${v._id}\` | /delvideo ${v._id}\n`;
    });

    if (text.length > 4000) {
        await ctx.replyWithDocument(new InputFile(Buffer.from(text, "utf-8"), "videos_list.txt"), {
            caption: `🎥 Total Videos: ${vids.length}`
        });
    } else {
        await ctx.reply(text, { parse_mode: "Markdown" });
    }
});

// --- DELETE VIDEO VIA COMMAND OR REPLY ---
bot.command("delvideo", async (ctx) => {
    const user = await User.findOne({ userId: ctx.from.id });
    if (!user || (!user.isAdmin && !user.isMainAdmin)) return;

    if (ctx.message.reply_to_message && ctx.message.reply_to_message.video) {
        const fileUniqueId = ctx.message.reply_to_message.video.file_unique_id;
        const deleted = await Video.findOneAndDelete({ uniqueId: fileUniqueId });
        if (deleted) return ctx.reply("🗑️ Video has been removed from the database!");
        else return ctx.reply("❌ This video was not found in the database.");
    }

    const objId = ctx.match.trim();
    if (!objId) return ctx.reply("Usage: /delvideo <ID> or reply to a video message with /delvideo");

    try {
        const deleted = await Video.findByIdAndDelete(objId);
        if (deleted) ctx.reply("🗑️ Video has been removed from the database!");
        else ctx.reply("❌ Invalid ID or video is already deleted.");
    } catch (e) {
        ctx.reply("❌ Invalid ID format.");
    }
});

bot.hears("/del", async (ctx) => {
    const user = await User.findOne({ userId: ctx.from.id });
    if (!user || (!user.isAdmin && !user.isMainAdmin)) return;

    if (!ctx.message.reply_to_message || !ctx.message.reply_to_message.video) {
        return ctx.reply("❌ Please reply to a bot's video message with /del");
    }

    const fileUniqueId = ctx.message.reply_to_message.video.file_unique_id;
    const deleted = await Video.findOneAndDelete({ uniqueId: fileUniqueId });
    if (deleted) {
        await ctx.reply("🗑️ Video has been removed from the database!");
    } else {
        await ctx.reply("❌ This video was not found in the database.");
    }
});

// --- CONVERSATION STATE HANDLER ---
bot.on("message:text", async (ctx) => {
    const user = await User.findOne({ userId: ctx.from.id });
    if (!user) return;

    if (user.botState === 'awaiting_admin_pass') {
        if (ctx.message.text === ADMIN_PASS) {
            user.botState = 'awaiting_admin_id';
            await user.save();
            return ctx.reply("✅ Correct Password! Now send the User ID of the new admin:");
        } else {
            user.botState = '';
            await user.save();
            return ctx.reply("❌ Incorrect Password! Adding admin cancelled.");
        }
    }

    if (user.botState === 'awaiting_admin_id') {
        const targetId = parseInt(ctx.message.text.trim());
        if (isNaN(targetId)) {
            return ctx.reply("❌ Invalid ID! Please send numbers only:");
        }
        user.botState = '';
        await user.save();

        const target = await User.findOneAndUpdate({ userId: targetId }, { isAdmin: true }, { new: true });
        if (target) {
            await ctx.reply(`✅ Successfully done! User ${targetId} is now an admin.`);
            try { await bot.api.sendMessage(targetId, "🎉 Congratulations! You have been made an Admin of the bot."); } catch (e) { }
        } else {
            await ctx.reply("❌ This ID was not found in the database. Ensure the ID has started the bot via /start.");
        }
    }
});

// --- EXPRESS SERVER PREVENTS RENDER CRASH & BOT START ---
app.get('/', (req, res) => {
    res.send('Bot is running!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Web server is listening on port ${PORT}`);
});

bot.start();