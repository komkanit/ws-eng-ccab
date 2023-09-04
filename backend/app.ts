import express from "express";
import { createClient, defineScript } from "redis";
import { json } from "body-parser";
import retry from 'async-retry';

const DEFAULT_BALANCE = 100;

interface ChargeResult {
    isAuthorized: boolean;
    remainingBalance: number;
    charges: number;
}

async function connect(): Promise<ReturnType<typeof createClient>> {
    const url = `redis://${process.env.REDIS_HOST ?? "localhost"}:${process.env.REDIS_PORT ?? "6379"}`;
    // console.log(`Using redis URL ${url}`);
    const client = createClient({
        url,
    });
    await client.connect();
    return client;
}

async function reset(account: string): Promise<void> {
    const client = await connect();
    try {
        await client.set(`${account}/balance`, DEFAULT_BALANCE);
    } finally {
        await client.disconnect();
    }
}

async function get(account: string): Promise<number> {
    const client = await connect();
    try {
        const remainingBalance = parseInt((await client.get(`${account}/balance`)) ?? "");
        return remainingBalance;
    } finally {
        await client.disconnect();
    }
}

async function charge(account: string, charges: number): Promise<ChargeResult> {
    const client = await connect();
    try {
        const balance = parseInt((await client.get(`${account}/balance`)) ?? "");
        if (balance >= charges) {
            await client.set(`${account}/balance`, balance - charges);
            const remainingBalance = parseInt((await client.get(`${account}/balance`)) ?? "");
            return { isAuthorized: true, remainingBalance, charges };
        } else {
            return { isAuthorized: false, remainingBalance: balance, charges: 0 };
        }
    } finally {
        await client.disconnect();
    }
}

async function chargeWithRetry(account: string, charges: number): Promise<ChargeResult> {
    const client = await connect();
    try {
        // Use the 'retry' function to wrap the core charging logic with retry capabilities.
        return await retry(
            async () => {
                const key = `${account}/balance`;
                
                // Watch the 'key' to monitor for changes during this transaction.
                await client.watch(key);
                
                const balance = parseInt((await client.get(key)) ?? "0");
                
                if (balance >= charges) {
                    const remainingBalance = balance - charges;
                    
                    // Start a Redis transaction using the 'multi' command.
                    // The following commands are queued up to be executed atomically.
                    const [_, remainingBalanceResponse] = await client
                        .multi()
                        .set(key, remainingBalance) // Update the balance in Redis.
                        .get(key) // Get the updated balance from Redis.
                        .exec(); // Execute the transaction.
                    
                    // Parse the updated balance response as an integer.
                    const updateBalance = parseInt(remainingBalanceResponse as string);
                    
                    return { isAuthorized: true, remainingBalance: updateBalance, charges };
                } else {
                    return { isAuthorized: false, remainingBalance: balance, charges: 0 };
                }
            },
            {
                minTimeout: 3, // Minimum time (in milliseconds) to wait before retrying.
                maxTimeout: 10, // Maximum time (in milliseconds) to wait before retrying.
            }
        );
    } finally {
        await client.disconnect();
    }
}

export function buildApp(): express.Application {
    const app = express();
    app.use(json());
    app.post("/reset", async (req, res) => {
        try {
            const account = req.body.account ?? "account";
            await reset(account);
            console.log(`Successfully reset account ${account}`);
            res.sendStatus(204);
        } catch (e) {
            console.error("Error while resetting account", e);
            res.status(500).json({ error: String(e) });
        }
    });
    app.post("/get", async (req, res) => {
        try {
            const account = req.body.account ?? "account";
            const result = await get(account);
            console.log(`remaining balance for account ${account} is ${result}`)
            res.status(200).json({ balance: result });
        } catch (e) {
            console.error("Error while getting account", e);
            res.status(500).json({ error: String(e) });
        }
    });
    app.post("/charge", async (req, res) => {
        try {
            const account = req.body.account ?? "account";
            console.log(`account ${account} is charging ${req.body.charges}`)
            const result = await chargeWithRetry(account, req.body.charges ?? 10);
            console.log(`charged account ${account}, charge: ${result.charges}, balance: ${result.remainingBalance}, isAuthorized: ${result.isAuthorized}`);
            res.status(200).json(result);
        } catch (e) {
            console.error("Error while charging account", e);
            res.status(500).json({ error: String(e) });
        }
    });
    return app;
}
