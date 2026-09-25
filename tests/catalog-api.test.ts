import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';

async function runCatalogApiTests() {
  console.log('🧪 Starting LuxeWear Kenya Catalog API Integration Test Suite...\n');
  let passed = 0;

  try {
    // ---------------------------------------------------------------
    // TEST 1: GET /api/v1/catalog/categories (Category Tree)
    // ---------------------------------------------------------------
    console.log('▶ TEST 1: GET /api/v1/catalog/categories');
    const resCategories = await request(app).get('/api/v1/catalog/categories');

    if (resCategories.status === 200 && Array.isArray(resCategories.body.data) && resCategories.body.data.length >= 3) {
      console.log(`   ✅ PASS: Category hierarchy returned ${resCategories.body.data.length} root categories.`);
      passed++;
    } else {
      throw new Error(`GET /api/v1/catalog/categories failed with status ${resCategories.status}`);
    }

    // ---------------------------------------------------------------
    // TEST 2: GET /api/v1/catalog/products (Default Paginated Products List)
    // ---------------------------------------------------------------
    console.log('\n▶ TEST 2: GET /api/v1/catalog/products (Paginated Product Catalog)');
    const resProducts = await request(app).get('/api/v1/catalog/products');

    if (resProducts.status === 200 && resProducts.body.meta.total >= 12) {
      console.log(`   ✅ PASS: Product catalog returned ${resProducts.body.meta.total} products.`);
      passed++;
    } else {
      throw new Error(`GET /api/v1/catalog/products failed with status ${resProducts.status}: ${JSON.stringify(resProducts.body)}`);
    }

    // ---------------------------------------------------------------
    // TEST 3: GET /api/v1/catalog/products?categorySlug=women-dresses
    // ---------------------------------------------------------------
    console.log('\n▶ TEST 3: GET /api/v1/catalog/products?categorySlug=women-dresses');
    const resFilteredCat = await request(app).get('/api/v1/catalog/products?categorySlug=women-dresses');

    if (resFilteredCat.status === 200 && resFilteredCat.body.data.length >= 3) {
      console.log(`   ✅ PASS: Category filter returned ${resFilteredCat.body.data.length} Gala/Midi dresses.`);
      passed++;
    } else {
      throw new Error(`GET /api/v1/catalog/products?categorySlug=women-dresses failed with status ${resFilteredCat.status}`);
    }

    // ---------------------------------------------------------------
    // TEST 4: GET /api/v1/catalog/products?categorySlug=non-existent-category (404 Handling)
    // ---------------------------------------------------------------
    console.log('\n▶ TEST 4: GET /api/v1/catalog/products?categorySlug=non-existent-category (404 Check)');
    const resCat404 = await request(app).get('/api/v1/catalog/products?categorySlug=non-existent-category');

    if (resCat404.status === 404 && resCat404.body.code === 'NOT_FOUND') {
      console.log('   ✅ PASS: Non-existent category slug correctly returned 404 NOT_FOUND.');
      passed++;
    } else {
      throw new Error(`Non-existent category test failed with status ${resCat404.status}`);
    }

    // ---------------------------------------------------------------
    // TEST 5: minPrice > maxPrice Refinement Check (400 Bad Request)
    // ---------------------------------------------------------------
    console.log('\n▶ TEST 5: GET /api/v1/catalog/products?minPrice=10000&maxPrice=5000 (Validation)');
    const resPriceInvalid = await request(app).get('/api/v1/catalog/products?minPrice=10000&maxPrice=5000');

    if (resPriceInvalid.status === 400 && resPriceInvalid.body.code === 'BAD_REQUEST') {
      console.log('   ✅ PASS: minPrice > maxPrice rejected with 400 BAD_REQUEST.');
      passed++;
    } else {
      throw new Error(`Price range validation test failed with status ${resPriceInvalid.status}`);
    }

    // ---------------------------------------------------------------
    // TEST 6: GET /api/v1/catalog/products?search=NonExistentSearchTerm999 (Empty Results)
    // ---------------------------------------------------------------
    console.log('\n▶ TEST 6: GET /api/v1/catalog/products?search=NonExistentSearchTerm999');
    const resSearchEmpty = await request(app).get('/api/v1/catalog/products?search=NonExistentSearchTerm999');

    if (resSearchEmpty.status === 200 && resSearchEmpty.body.data.length === 0) {
      console.log('   ✅ PASS: Search with zero matches returned empty array with total = 0.');
      passed++;
    } else {
      throw new Error(`Empty search test failed with status ${resSearchEmpty.status}`);
    }

    // ---------------------------------------------------------------
    // TEST 7: GET /api/v1/catalog/products/:slug (Detail & Stock Privacy Check)
    // ---------------------------------------------------------------
    console.log('\n▶ TEST 7: GET /api/v1/catalog/products/nairobi-nights-satin-gala-dress (Detail & Privacy)');
    const resDetail = await request(app).get('/api/v1/catalog/products/nairobi-nights-satin-gala-dress');

    if (
      resDetail.status === 200 &&
      resDetail.body.data.slug === 'nairobi-nights-satin-gala-dress' &&
      resDetail.body.data.variants.length === 4
    ) {
      const hasStockStatus = resDetail.body.data.variants.every(
        (v: any) => v.stockStatus === 'IN_STOCK' || v.stockStatus === 'LOW_STOCK' || v.stockStatus === 'OUT_OF_STOCK'
      );
      const omitsRawStockQuantity = resDetail.body.data.variants.every((v: any) => v.stockQuantity === undefined);

      if (hasStockStatus && omitsRawStockQuantity) {
        console.log('   ✅ PASS: Product detail returned stockStatus badges while preserving raw stock privacy.');
        passed++;
      } else {
        throw new Error('Public inventory privacy failed: raw stockQuantity exposed or stockStatus missing.');
      }
    } else {
      throw new Error(`GET product detail failed with status ${resDetail.status}`);
    }

    // ---------------------------------------------------------------
    // TEST 8: GET /api/v1/catalog/products/:slug (404 Non-Existent Product)
    // ---------------------------------------------------------------
    console.log('\n▶ TEST 8: GET /api/v1/catalog/products/invalid-slug-999');
    const res404 = await request(app).get('/api/v1/catalog/products/invalid-slug-999');

    if (res404.status === 404 && res404.body.code === 'NOT_FOUND') {
      console.log('   ✅ PASS: Non-existent product slug correctly returned 404 NOT_FOUND.');
      passed++;
    } else {
      throw new Error(`404 product test failed with status ${res404.status}`);
    }

    console.log(`\n🎉 SUMMARY: All ${passed} / ${passed} Catalog API Integration Tests PASSED Successfully!`);
  } catch (err) {
    console.error('\n❌ Catalog API Test Failed:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runCatalogApiTests();
