import { Context, Telegraf } from 'telegraf';
import { Update } from 'telegraf/typings/core/types/typegram';
import { VersionedTransaction, Connection, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

// Initialize Telegraf bot
const bot: Telegraf<Context<Update>> = new Telegraf(process.env.BOT_TOKEN as string);
// Update the userWallets structure to store selected wallet and wallet list
const userWallets: { [chatId: string]: { wallets: string[]; selectedWallet?: string } } = {};
const RPC_ENDPOINT = "Your RPC Endpoint";
const web3Connection = new Connection(RPC_ENDPOINT, 'confirmed');

// Define trade history and active token monitoring
const tradeHistory: Array<{ token: string; action: string; amount: number; buyPrice: number; sellPrice?: number }> = [];
const monitoredTokens: Array<{ name: string; mint: string }> = [];

// Command to connect a wallet
// Command to connect a wallet
bot.command('connect_wallet', (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId) return;

    const walletAddress = ctx.message?.text?.split(' ')[1]; // Get wallet address from the message

    if (walletAddress) {
        if (!userWallets[chatId]) {
            userWallets[chatId] = { wallets: [] };
        }

        userWallets[chatId].wallets.push(walletAddress);
        ctx.reply(`✅ Wallet ${walletAddress} connected!`);
    } else {
        ctx.reply('❌ Please provide a valid wallet address. Usage: /connect_wallet <wallet_address>');
    }
});

// Command to list connected wallets
bot.command('list_wallets', (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId || !userWallets[chatId]) {
        ctx.reply('❌ You have no connected wallets.');
        return;
    }

    const wallets = userWallets[chatId].wallets.join('\n');
    ctx.reply(`Your connected wallets:\n${wallets}`);
});

// Command to switch wallet
bot.command('switch_wallet', (ctx) => {
    const chatId = ctx.chat?.id.toString();
    if (!chatId || !userWallets[chatId]) {
        ctx.reply('❌ You have no connected wallets.');
        return;
    }

    const selectedWallet = ctx.message?.text?.split(' ')[1]; // Get wallet address to switch to

    if (selectedWallet && userWallets[chatId].wallets.includes(selectedWallet)) {
        // Set the selected wallet
        userWallets[chatId].selectedWallet = selectedWallet;
        ctx.reply(`✅ Switched to wallet ${selectedWallet}`);
    } else {
        ctx.reply('❌ Invalid wallet address. Please select a valid wallet.');
    }
});

// Fetch new tokens from Pump.fun API
async function fetchNewTokens(apiKey: string) {
    try {
        const response = await fetch('https://api.pump.fun/v1/tokens', {
            method: 'GET',
            headers: { Authorization: `Bearer ${apiKey}` },
        });

        if (!response.ok) {
            console.error('Failed to fetch new tokens:', await response.text());
            return [];
        }

        const data = await response.json();
        return data.tokens.map((token: { name: string; mint: string }) => ({ name: token.name, mint: token.mint }));
    } catch (error) {
        console.error('Error fetching new tokens:', error);
        return [];
    }
}

// Buy token using Pump.fun API
async function buyToken(mint: string, amount: number, slippage: number, bot: Telegraf, chatId: string) {
    const chatIdStr = chatId.toString();
    const selectedWallet = userWallets[chatIdStr]?.selectedWallet;

    if (!selectedWallet) {
        await bot.telegram.sendMessage(chatId, '❌ No wallet selected. Please connect and select a wallet first.');
        return false;
    }

    try {
        // Decode the private key from the selected wallet (assumed to be in base58 format)
        const privateKey = bs58.decode(selectedWallet);
        const signerKeyPair = Keypair.fromSecretKey(privateKey);

        const response = await fetch('https://pumpportal.fun/api/trade-local', {
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
            const data = await response.arrayBuffer();
            const transaction = VersionedTransaction.deserialize(new Uint8Array(data));
            transaction.sign([signerKeyPair]);
            const signature = await web3Connection.sendTransaction(transaction);
            console.log(`Transaction successful: https://solscan.io/tx/${signature}`);
            await bot.telegram.sendMessage(chatId, `✅ Successfully bought ${amount} of token: ${mint}`);
            return true;
        } else {
            console.error('Failed to buy token:', await response.text());
            await bot.telegram.sendMessage(chatId, `❌ Failed to buy token: ${mint}`);
            return false;
        }
    } catch (error) {
        console.error('Error buying token:', error);
        await bot.telegram.sendMessage(chatId, `❌ Failed to buy token: ${mint}`);
        return false;
    }
}

// Sell token when 20% profit is reached
async function sellToken(token: string, amount: number, currentPrice: number, bot: Telegraf, chatId: string) {
    const chatIdStr = chatId.toString();
    const selectedWallet = userWallets[chatIdStr]?.selectedWallet;

    if (!selectedWallet) {
        await bot.telegram.sendMessage(chatId, '❌ No wallet selected. Please connect and select a wallet first.');
        return false;
    }

    const trade = tradeHistory.find((t) => t.token === token && t.action === 'buy');
    if (trade && currentPrice >= trade.buyPrice * 1.2) {
        try {
            // Decode the private key from the selected wallet (assumed to be in base58 format)
            const privateKey = bs58.decode(selectedWallet);
            const signerKeyPair = Keypair.fromSecretKey(privateKey);

            const response = await fetch('https://pumpportal.fun/api/trade-local', {
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
                const data = await response.arrayBuffer();
                const transaction = VersionedTransaction.deserialize(new Uint8Array(data));
                transaction.sign([signerKeyPair]);
                const signature = await web3Connection.sendTransaction(transaction);
                console.log(`Transaction successful: https://solscan.io/tx/${signature}`);
                await bot.telegram.sendMessage(chatId, `✅ Successfully sold ${amount} of token: ${token} at 20% profit!`);
                trade.sellPrice = currentPrice;
                return true;
            } else {
                console.error('Failed to sell token:', await response.text());
                await bot.telegram.sendMessage(chatId, `❌ Failed to sell token: ${token}`);
                return false;
            }
        } catch (error) {
            console.error('Error selling token:', error);
            await bot.telegram.sendMessage(chatId, `❌ Failed to sell token: ${token}`);
            return false;
        }
    }

    return false;
}

// Monitor and trade tokens
async function monitorAndTrade(env: any, bot: Telegraf) {
    const newTokens = await fetchNewTokens(process.env.PUMPFUN_API_KEY as string);
    for (const token of newTokens) {
        if (!monitoredTokens.some((t) => t.mint === token.mint)) {
            monitoredTokens.push(token);
            await bot.telegram.sendMessage(process.env.TELEGRAM_CHAT_ID as string, `🚀 New token detected: ${token.name} (${token.mint})`);

            // Simulate buying the new token
            const buySuccess = await buyToken(token.mint, 1000, 10, bot, process.env.TELEGRAM_CHAT_ID as string);
            if (buySuccess) {
                tradeHistory.push({ token: token.mint, action: 'buy', amount: 1000, buyPrice: 1.0 }); // Assuming price of 1 SOL for simplicity
            }
        }
    }

    // Check for sell opportunities
    for (const trade of tradeHistory.filter((t) => t.action === 'buy' && !t.sellPrice)) {
        const currentPrice = 1.2; // Replace with real price fetching logic
        await sellToken(trade.token, trade.amount, currentPrice, bot, process.env.TELEGRAM_CHAT_ID as string);
    }
}

// Start monitoring
(async () => {

    console.log('Starting token monitoring...');
    setInterval(() => monitorAndTrade(process.env, bot), 30000); // Monitor every 30 seconds

    bot.launch();
})();
