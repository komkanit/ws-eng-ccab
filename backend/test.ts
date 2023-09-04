import { performance } from "perf_hooks";
import supertest from "supertest";
import { buildApp } from "./app";

const app = supertest(buildApp());

async function basicLatencyTest() {
    await app.post("/reset").expect(204);
    const start = performance.now();
    await app.post("/charge").expect(200);
    await app.post("/charge").expect(200);
    await app.post("/charge").expect(200);
    await app.post("/charge").expect(200);
    await app.post("/charge").expect(200);
    console.log(`Latency: ${performance.now() - start} ms`);
}

async function parallelChargesTest() {
    await app.post("/reset").send({ account: 'test' }).expect(204);
    const start = performance.now();
    await Promise.all([
        app.post("/charge").send({ account: 'test', charges: 60 }),
        app.post("/charge").send({ account: 'test', charges: 30 }),
        app.post("/charge").send({ account: 'test', charges: 10 }),
    ])
    await app.post("/get").send({ account: 'test' }).expect(200)

    await app.post("/charge").send({ account: 'test', charges: 10 }),

    await app.post("/get").send({ account: 'test' }).expect(200)
    console.log(`Latency: ${performance.now() - start} ms`);
}

async function runTests() {
    await basicLatencyTest();
    await parallelChargesTest();
}

runTests().catch(console.error);
