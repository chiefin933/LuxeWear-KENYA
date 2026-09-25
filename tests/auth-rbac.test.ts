import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import jwt from 'jsonwebtoken';
import { env } from '../src/config/env.js';
import { RoleName } from '@prisma/client';

async function runAuthRbacTests() {
  console.log('🧪 Starting LuxeWear Kenya Authentication & RBAC Integration Test Suite...\n');
  let passed = 0;

  try {
    // ---------------------------------------------------------------
    // TEST 1: Successful Login with Valid Seed Admin Credentials
    // ---------------------------------------------------------------
    console.log('▶ TEST 1: POST /api/v1/auth/login (Valid Credentials)');
    const resLogin = await request(app).post('/api/v1/auth/login').send({
      email: 'admin@luxewear.co.ke',
      password: 'AdminSecret2026!',
    });

    if (resLogin.status === 200 && resLogin.body.data.accessToken) {
      console.log('   ✅ PASS: Admin login succeeded. JWT token and roles returned.');
      passed++;
    } else {
      throw new Error(`Login failed with status ${resLogin.status}: ${JSON.stringify(resLogin.body)}`);
    }

    const adminToken = resLogin.body.data.accessToken;

    // ---------------------------------------------------------------
    // TEST 2: Failed Login with Invalid Password
    // ---------------------------------------------------------------
    console.log('\n▶ TEST 2: POST /api/v1/auth/login (Invalid Password)');
    const resInvalid = await request(app).post('/api/v1/auth/login').send({
      email: 'admin@luxewear.co.ke',
      password: 'WrongPassword123!',
    });

    if (resInvalid.status === 401 && resInvalid.body.code === 'UNAUTHORIZED') {
      console.log('   ✅ PASS: Invalid password correctly rejected with status 401 UNAUTHORIZED.');
      passed++;
    } else {
      throw new Error(`Invalid password test failed with status ${resInvalid.status}`);
    }

    // ---------------------------------------------------------------
    // TEST 3: Strict Zod Schema Parameter Injection Prevention
    // ---------------------------------------------------------------
    console.log('\n▶ TEST 3: Strict Zod Schema Parsing (Reject Parameter Injection)');
    const resInject = await request(app).post('/api/v1/auth/login').send({
      email: 'admin@luxewear.co.ke',
      password: 'AdminSecret2026!',
      role: 'SUPER_ADMIN', // Extra unallowed property
    });

    if (resInject.status === 400 && resInject.body.code === 'BAD_REQUEST') {
      console.log('   ✅ PASS: Unknown body field rejected by strict Zod schema parsing.');
      passed++;
    } else {
      throw new Error(`Strict validation test failed with status ${resInject.status}`);
    }

    // ---------------------------------------------------------------
    // TEST 4: Authenticated Profile Lookup (GET /api/v1/auth/me)
    // ---------------------------------------------------------------
    console.log('\n▶ TEST 4: GET /api/v1/auth/me (Authenticated Profile)');
    const resProfile = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${adminToken}`);

    if (resProfile.status === 200 && resProfile.body.data.email === 'admin@luxewear.co.ke') {
      console.log('   ✅ PASS: Profile returned for authenticated user with permissions.');
      passed++;
    } else {
      throw new Error(`Profile lookup failed with status ${resProfile.status}`);
    }

    // ---------------------------------------------------------------
    // TEST 5: Unauthenticated Access Rejection
    // ---------------------------------------------------------------
    console.log('\n▶ TEST 5: GET /api/v1/auth/me (Unauthenticated)');
    const resNoToken = await request(app).get('/api/v1/auth/me');

    if (resNoToken.status === 401 && resNoToken.body.code === 'UNAUTHORIZED') {
      console.log('   ✅ PASS: Missing token rejected with 401 UNAUTHORIZED.');
      passed++;
    } else {
      throw new Error(`Unauthenticated test failed with status ${resNoToken.status}`);
    }

    // ---------------------------------------------------------------
    // TEST 6: RBAC Role & Permission Guards
    // ---------------------------------------------------------------
    console.log('\n▶ TEST 6: RBAC Role & Permission Enforcement');

    // Super Admin Token accessing Super Admin Route -> 200
    const resSuper = await request(app)
      .get('/api/v1/admin/super-only')
      .set('Authorization', `Bearer ${adminToken}`);

    if (resSuper.status !== 200) {
      throw new Error(`Super Admin access failed with status ${resSuper.status}`);
    }

    // Forge a non-admin Token (e.g. INVENTORY_CLERK with no super-admin role)
    const clerkToken = jwt.sign(
      {
        userId: 'clerk_user_id',
        email: 'clerk@luxewear.co.ke',
        roles: [RoleName.INVENTORY_CLERK],
        permissions: ['inventory:adjust'],
      },
      env.JWT_SECRET,
      { expiresIn: '1h', issuer: 'LuxeWear Kenya' }
    );

    const resForbidden = await request(app)
      .get('/api/v1/admin/super-only')
      .set('Authorization', `Bearer ${clerkToken}`);

    if (resForbidden.status === 403 && resForbidden.body.code === 'FORBIDDEN') {
      console.log('   ✅ PASS: Non-admin token correctly forbidden from Super Admin route with status 403.');
      passed++;
    } else {
      throw new Error(`RBAC forbidden test failed with status ${resForbidden.status}`);
    }

    console.log(`\n🎉 SUMMARY: All ${passed} / ${passed} Authentication & RBAC Integration Tests PASSED!`);
  } catch (err) {
    console.error('\n❌ Auth & RBAC Test Failed:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runAuthRbacTests();
