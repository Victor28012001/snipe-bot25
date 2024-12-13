"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const telegraf_1 = require("telegraf");
const web3_js_1 = require("@solana/web3.js");
const bs58_1 = __importDefault(require("bs58"));
// Initialize Telegraf bot
const bot = new telegraf_1.Telegraf(process.env.BOT_TOKEN);
// Update the userWallets structure to store selected wallet and wallet list
const userWallets = {};
const RPC_ENDPOINT = "Your RPC Endpoint";
const web3Connection = new web3_js_1.Connection(RPC_ENDPOINT, 'confirmed');
// Define trade history and active token monitoring
const tradeHistory = [];
const monitoredTokens = [];
// Command to connect a wallet
// Command to connect a wallet
bot.command('connect_wallet', (ctx) => {
    var _a, _b, _c;
    const chatId = (_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.id.toString();
    if (!chatId)
        return;
    const walletAddress = (_c = (_b = ctx.message) === null || _b === void 0 ? void 0 : _b.text) === null || _c === void 0 ? void 0 : _c.split(' ')[1]; // Get wallet address from the message
    if (walletAddress) {
        if (!userWallets[chatId]) {
            userWallets[chatId] = { wallets: [] };
        }
        userWallets[chatId].wallets.push(walletAddress);
        ctx.reply(`✅ Wallet ${walletAddress} connected!`);
    }
    else {
        ctx.reply('❌ Please provide a valid wallet address. Usage: /connect_wallet <wallet_address>');
    }
});
// Command to list connected wallets
bot.command('list_wallets', (ctx) => {
    var _a;
    const chatId = (_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.id.toString();
    if (!chatId || !userWallets[chatId]) {
        ctx.reply('❌ You have no connected wallets.');
        return;
    }
    const wallets = userWallets[chatId].wallets.join('\n');
    ctx.reply(`Your connected wallets:\n${wallets}`);
});
// Command to switch wallet
bot.command('switch_wallet', (ctx) => {
    var _a, _b, _c;
    const chatId = (_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.id.toString();
    if (!chatId || !userWallets[chatId]) {
        ctx.reply('❌ You have no connected wallets.');
        return;
    }
    const selectedWallet = (_c = (_b = ctx.message) === null || _b === void 0 ? void 0 : _b.text) === null || _c === void 0 ? void 0 : _c.split(' ')[1]; // Get wallet address to switch to
    if (selectedWallet && userWallets[chatId].wallets.includes(selectedWallet)) {
        // Set the selected wallet
        userWallets[chatId].selectedWallet = selectedWallet;
        ctx.reply(`✅ Switched to wallet ${selectedWallet}`);
    }
    else {
        ctx.reply('❌ Invalid wallet address. Please select a valid wallet.');
    }
});
// Fetch new tokens from Pump.fun API
function fetchNewTokens(apiKey) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const response = yield fetch('https://api.pump.fun/v1/tokens', {
                method: 'GET',
                headers: { Authorization: `Bearer ${apiKey}` },
            });
            if (!response.ok) {
                console.error('Failed to fetch new tokens:', yield response.text());
                return [];
            }
            const data = yield response.json();
            return data.tokens.map((token) => ({ name: token.name, mint: token.mint }));
        }
        catch (error) {
            console.error('Error fetching new tokens:', error);
            return [];
        }
    });
}
// Buy token using Pump.fun API
function buyToken(mint, amount, slippage, bot, chatId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const chatIdStr = chatId.toString();
        const selectedWallet = (_a = userWallets[chatIdStr]) === null || _a === void 0 ? void 0 : _a.selectedWallet;
        if (!selectedWallet) {
            yield bot.telegram.sendMessage(chatId, '❌ No wallet selected. Please connect and select a wallet first.');
            return false;
        }
        try {
            // Decode the private key from the selected wallet (assumed to be in base58 format)
            const privateKey = bs58_1.default.decode(selectedWallet);
            const signerKeyPair = web3_js_1.Keypair.fromSecretKey(privateKey);
            const response = yield fetch('https://pumpportal.fun/api/trade-local', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    publicKey: signerKeyPair.publicKey.toBase58(),
                    action: 'buy',
                    mint,
                    denominatedInSol: 'false',
                    amount,
                    slippage,
                    priorityFee: 0.00001,
                    pool: 'pump',
                }),
            });
            if (response.status === 200) {
                const data = yield response.arrayBuffer();
                const transaction = web3_js_1.VersionedTransaction.deserialize(new Uint8Array(data));
                transaction.sign([signerKeyPair]);
                const signature = yield web3Connection.sendTransaction(transaction);
                console.log(`Transaction successful: https://solscan.io/tx/${signature}`);
                yield bot.telegram.sendMessage(chatId, `✅ Successfully bought ${amount} of token: ${mint}`);
                return true;
            }
            else {
                console.error('Failed to buy token:', yield response.text());
                yield bot.telegram.sendMessage(chatId, `❌ Failed to buy token: ${mint}`);
                return false;
            }
        }
        catch (error) {
            console.error('Error buying token:', error);
            yield bot.telegram.sendMessage(chatId, `❌ Failed to buy token: ${mint}`);
            return false;
        }
    });
}
// Sell token when 20% profit is reached
function sellToken(token, amount, currentPrice, bot, chatId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const chatIdStr = chatId.toString();
        const selectedWallet = (_a = userWallets[chatIdStr]) === null || _a === void 0 ? void 0 : _a.selectedWallet;
        if (!selectedWallet) {
            yield bot.telegram.sendMessage(chatId, '❌ No wallet selected. Please connect and select a wallet first.');
            return false;
        }
        const trade = tradeHistory.find((t) => t.token === token && t.action === 'buy');
        if (trade && currentPrice >= trade.buyPrice * 1.2) {
            try {
                // Decode the private key from the selected wallet (assumed to be in base58 format)
                const privateKey = bs58_1.default.decode(selectedWallet);
                const signerKeyPair = web3_js_1.Keypair.fromSecretKey(privateKey);
                const response = yield fetch('https://pumpportal.fun/api/trade-local', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        publicKey: signerKeyPair.publicKey.toBase58(),
                        action: 'sell',
                        mint: token,
                        denominatedInSol: 'false',
                        amount,
                        slippage: 10,
                        priorityFee: 0.00001,
                        pool: 'pump',
                    }),
                });
                if (response.status === 200) {
                    const data = yield response.arrayBuffer();
                    const transaction = web3_js_1.VersionedTransaction.deserialize(new Uint8Array(data));
                    transaction.sign([signerKeyPair]);
                    const signature = yield web3Connection.sendTransaction(transaction);
                    console.log(`Transaction successful: https://solscan.io/tx/${signature}`);
                    yield bot.telegram.sendMessage(chatId, `✅ Successfully sold ${amount} of token: ${token} at 20% profit!`);
                    trade.sellPrice = currentPrice;
                    return true;
                }
                else {
                    console.error('Failed to sell token:', yield response.text());
                    yield bot.telegram.sendMessage(chatId, `❌ Failed to sell token: ${token}`);
                    return false;
                }
            }
            catch (error) {
                console.error('Error selling token:', error);
                yield bot.telegram.sendMessage(chatId, `❌ Failed to sell token: ${token}`);
                return false;
            }
        }
        return false;
    });
}
// Monitor and trade tokens
function monitorAndTrade(env, bot) {
    return __awaiter(this, void 0, void 0, function* () {
        const newTokens = yield fetchNewTokens(process.env.PUMPFUN_API_KEY);
        for (const token of newTokens) {
            if (!monitoredTokens.some((t) => t.mint === token.mint)) {
                monitoredTokens.push(token);
                yield bot.telegram.sendMessage(process.env.TELEGRAM_CHAT_ID, `🚀 New token detected: ${token.name} (${token.mint})`);
                // Simulate buying the new token
                const buySuccess = yield buyToken(token.mint, 1000, 10, bot, process.env.TELEGRAM_CHAT_ID);
                if (buySuccess) {
                    tradeHistory.push({ token: token.mint, action: 'buy', amount: 1000, buyPrice: 1.0 }); // Assuming price of 1 SOL for simplicity
                }
            }
        }
        // Check for sell opportunities
        for (const trade of tradeHistory.filter((t) => t.action === 'buy' && !t.sellPrice)) {
            const currentPrice = 1.2; // Replace with real price fetching logic
            yield sellToken(trade.token, trade.amount, currentPrice, bot, process.env.TELEGRAM_CHAT_ID);
        }
    });
}
// Start monitoring
(() => __awaiter(void 0, void 0, void 0, function* () {
    console.log('Starting token monitoring...');
    setInterval(() => monitorAndTrade(process.env, bot), 30000); // Monitor every 30 seconds
    bot.launch();
}))();
//# sourceMappingURL=app.js.map