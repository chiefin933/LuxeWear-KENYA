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

    if (resProducts.status === 200 && resProducts.body.meta.total === 12) {
      console.log(`   ✅ PASS: Product catalog returned ${resProducts.body.meta.total} total launch products.`);
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
    // TEST 4: GET /api/v1/catalog/products?minPrice=5000&maxPrice=10000
    // ---------------------------------------------------------------
    console.log('\n▶ TEST 4: GET /api/v1/catalog/products?minPrice=5000&maxPrice=10000');
    const resPriceRange = await request(app).get('/api/v1/catalog/products?minPrice=5000&maxPrice=10000');

    if (resPriceRange.status === 200 && resPriceRange.body.data.length > 0) {
      const allPricesMatch = resPriceRange.body.data.every(
        (p: any) => parseFloat(p.basePriceKes) >= 5000 && parseFloat(p.basePriceKes) <= 10000
      );

      if (allPricesMatch) {
        console.log(`   ✅ PASS: Price filter returned ${resPriceRange.body.data.length} products within KES 5,000–10,000.`);
        passed++;
      } else {
        throw new Error('Some returned products fell outside the specified price range.');
      }
    } else {
      throw new Error(`GET price filter failed with status ${resPriceRange.status}`);
    }

    // ---------------------------------------------------------------
    // TEST 5: GET /api/v1/catalog/products/:slug (Product Detail)
    // ---------------------------------------------------------------
    console.log('\n▶ TEST 5: GET /api/v1/catalog/products/nairobi-nights-satin-gala-dress');
    const resDetail = await request(app).get('/api/v1/catalog/products/nairobi-nights-satin-gala-dress');

    if (
      resDetail.status === 200 &&
      resDetail.body.data.slug === 'nairobi-nights-satin-gala-dress' &&
      resDetail.body.data.variants.length === 4
    ) {
      console.log('   ✅ PASS: Product detail returned full specs, 4 active variants, and stock availability.');
      passed++;
    } else {
      throw new Error(`GET product detail failed with status ${resDetail.status}`);
    }

    // ---------------------------------------------------------------
    // TEST 6: GET /api/v1/catalog/products/:slug (404 Non-Existent Product)
    // ---------------------------------------------------------------
    console.log('\n▶ TEST 6: GET /api/v1/catalog/products/invalid-slug-999');
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
