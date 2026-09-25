import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';

async function runFoundationTests() {
  console.log('🧪 Starting LuxeWear Kenya Backend Foundation Test Suite...\n');
  let passed = 0;

  try {
    // 1. Test /health Liveness Endpoint
    console.log('▶ TEST 1: GET /health (Liveness Endpoint)');
    const resLiveness = await request(app).get('/health');
    if (resLiveness.status === 200 && resLiveness.body.status === 'UP') {
      console.log('   ✅ PASS: /health returned status 200 UP.');
      passed++;
    } else {
      throw new Error(`GET /health failed with status ${resLiveness.status}`);
    }

    // 2. Test /api/v1/health Readiness Endpoint (PostgreSQL DB ping)
    console.log('\n▶ TEST 2: GET /api/v1/health (Database Readiness Endpoint)');
    const resReadiness = await request(app).get('/api/v1/health');
    if (resReadiness.status === 200 && resReadiness.body.database === 'CONNECTED') {
      console.log('   ✅ PASS: /api/v1/health confirmed PostgreSQL database is CONNECTED.');
      passed++;
    } else {
      throw new Error(`GET /api/v1/health failed with status ${resReadiness.status}`);
    }

    // 3. Test X-Correlation-ID header generation
    console.log('\n▶ TEST 3: X-Correlation-ID Header Generation');
    const customCorrelationId = 'TEST-CORRELATION-ID-9921';
    const resHeader = await request(app)
      .get('/health')
      .set('X-Correlation-ID', customCorrelationId);

    if (resHeader.headers['x-correlation-id'] === customCorrelationId) {
      console.log(`   ✅ PASS: X-Correlation-ID header correctly propagated (${customCorrelationId}).`);
      passed++;
    } else {
      throw new Error('X-Correlation-ID header propagation failed');
    }

    // 4. Test 404 Handler & RFC 7807 Structured Error Format
    console.log('\n▶ TEST 4: 404 Not Found & Structured Error Response');
    const res404 = await request(app).get('/api/v1/non-existent-route-1234');
    if (res404.status === 404 && res404.body.code === 'NOT_FOUND' && res404.body.success === false) {
      console.log('   ✅ PASS: 404 route returned structured RFC 7807 error format with code NOT_FOUND.');
      passed++;
    } else {
      throw new Error(`404 error formatting test failed with status ${res404.status}`);
    }

    console.log(`\n🎉 SUMMARY: All ${passed} / ${passed} Backend Foundation Tests PASSED Successfully!`);
  } catch (err) {
    console.error('\n❌ Backend Foundation Test Failed:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runFoundationTests();
