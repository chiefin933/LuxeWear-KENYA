import { PrismaClient, RoleName } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting LuxeWear Kenya Database Seed...');

  // 1. Seed Roles & Permissions
  console.log('🔐 Seeding Roles & Permissions...');
  const rolesData = [
    { name: RoleName.SUPER_ADMIN, description: 'Full system administration and store management access' },
    { name: RoleName.STORE_MANAGER, description: 'Catalog, order fulfillment, and report access' },
    { name: RoleName.CUSTOMER_SUPPORT, description: 'Customer inquiry and order status access' },
    { name: RoleName.INVENTORY_CLERK, description: 'Stock movement and inventory management access' },
  ];

  for (const r of rolesData) {
    await prisma.role.upsert({
      where: { name: r.name },
      update: { description: r.description },
      create: r,
    });
  }

  // Seed sample permissions
  const permissionsData = [
    { action: 'products:read', description: 'View product catalog' },
    { action: 'products:write', description: 'Create and edit products' },
    { action: 'orders:read', description: 'View customer orders' },
    { action: 'orders:fulfill', description: 'Dispatch and update order fulfillment' },
    { action: 'inventory:adjust', description: 'Adjust stock levels' },
  ];

  for (const p of permissionsData) {
    await prisma.permission.upsert({
      where: { action: p.action },
      update: { description: p.description },
      create: p,
    });
  }

  // Link permissions to SUPER_ADMIN role
  const superAdminRole = await prisma.role.findUnique({ where: { name: RoleName.SUPER_ADMIN } });
  const allPermissions = await prisma.permission.findMany();

  if (superAdminRole) {
    for (const perm of allPermissions) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: superAdminRole.id,
            permissionId: perm.id,
          },
        },
        update: {},
        create: {
          roleId: superAdminRole.id,
          permissionId: perm.id,
        },
      });
    }
  }

  // 2. Seed Admin User
  console.log('👤 Seeding Admin User...');
  const adminPasswordHash = bcrypt.hashSync('AdminSecret2026!', 10);

  await prisma.user.upsert({
    where: { email: 'admin@luxewear.co.ke' },
    update: { passwordHash: adminPasswordHash },
    create: {
      email: 'admin@luxewear.co.ke',
      fullName: 'Super Admin',
      passwordHash: adminPasswordHash,
      isActive: true,
      userRoles: {
        create: {
          roleId: superAdminRole!.id,
        },
      },
    },
  });

  // 3. Seed Categories
  console.log('👗 Seeding Categories...');
  const catWomen = await prisma.category.upsert({
    where: { slug: 'women' },
    update: {},
    create: { name: "Women's Collection", slug: 'women', description: 'Luxury apparel for contemporary women' },
  });

  const catWomenDresses = await prisma.category.upsert({
    where: { slug: 'women-dresses' },
    update: {},
    create: { name: 'Evening & Gala Dresses', slug: 'women-dresses', parentId: catWomen.id },
  });

  const catWomenSets = await prisma.category.upsert({
    where: { slug: 'women-two-piece' },
    update: {},
    create: { name: 'Two-Piece Sets', slug: 'women-two-piece', parentId: catWomen.id },
  });

  const catWomenTops = await prisma.category.upsert({
    where: { slug: 'women-tops' },
    update: {},
    create: { name: 'Tops & Blouses', slug: 'women-tops', parentId: catWomen.id },
  });

  const catMen = await prisma.category.upsert({
    where: { slug: 'men' },
    update: {},
    create: { name: "Men's Collection", slug: 'men', description: 'Tailored and relaxed luxury menswear' },
  });

  const catMenShirts = await prisma.category.upsert({
    where: { slug: 'men-shirts' },
    update: {},
    create: { name: 'Linen Shirts', slug: 'men-shirts', parentId: catMen.id },
  });

  const catMenTrousers = await prisma.category.upsert({
    where: { slug: 'men-trousers' },
    update: {},
    create: { name: 'Tailored Trousers', slug: 'men-trousers', parentId: catMen.id },
  });

  const catMenOuterwear = await prisma.category.upsert({
    where: { slug: 'men-outerwear' },
    update: {},
    create: { name: 'Outerwear & Blazers', slug: 'men-outerwear', parentId: catMen.id },
  });

  const catAccessories = await prisma.category.upsert({
    where: { slug: 'accessories' },
    update: {},
    create: { name: 'Accessories & Leatherware', slug: 'accessories', description: 'Handbags, belts, and silk scarves' },
  });

  // 4. Seed Products, Variants, Images & Initial Inventory
  console.log('📦 Seeding 12 Core Launch Products & Variants...');

  const productsData = [
    {
      skuPrefix: 'LW-W-DRS-01',
      name: 'Nairobi Nights Satin Gala Dress',
      slug: 'nairobi-nights-satin-gala-dress',
      description: 'Floor-length premium silk satin evening gown with structured corset bodice and elegant side slit.',
      fabricCare: '100% Pure Silk Satin. Dry Clean Only.',
      basePriceKes: 8500,
      categoryId: catWomenDresses.id,
      isFeatured: true,
      variants: [
        { size: 'S', color: 'Emerald Green', colorHex: '#046307', stock: 10 },
        { size: 'M', color: 'Emerald Green', colorHex: '#046307', stock: 10 },
        { size: 'L', color: 'Emerald Green', colorHex: '#046307', stock: 10 },
        { size: 'XL', color: 'Midnight Black', colorHex: '#121212', stock: 10 },
      ],
      images: [
        { url: '/images/products/nairobi-nights-green.jpg', isThumbnail: true, altText: 'Emerald Green Gala Dress' },
      ],
    },
    {
      skuPrefix: 'LW-W-DRS-02',
      name: 'Savannah Gold Draped Silk Midi',
      slug: 'savannah-gold-draped-silk-midi',
      description: 'Sophisticated cowl-neck midi dress cut on the bias for an effortless draped silhouette.',
      fabricCare: 'Silk Blend. Hand Wash Cold / Dry Clean.',
      basePriceKes: 7200,
      categoryId: catWomenDresses.id,
      isFeatured: true,
      variants: [
        { size: 'XS', color: 'Champagne Gold', colorHex: '#E5C158', stock: 8 },
        { size: 'S', color: 'Champagne Gold', colorHex: '#E5C158', stock: 8 },
        { size: 'M', color: 'Deep Burgundy', colorHex: '#580816', stock: 8 },
        { size: 'L', color: 'Deep Burgundy', colorHex: '#580816', stock: 8 },
      ],
      images: [
        { url: '/images/products/savannah-gold-midi.jpg', isThumbnail: true, altText: 'Champagne Gold Silk Midi' },
      ],
    },
    {
      skuPrefix: 'LW-W-SET-01',
      name: 'Karen Executive Blazer & Trouser Set',
      slug: 'karen-executive-blazer-trouser-set',
      description: 'Tailored double-breasted crepe blazer paired with high-waisted wide-leg trousers.',
      fabricCare: 'Structured Crepe Blend. Dry Clean Recommended.',
      basePriceKes: 11500,
      categoryId: catWomenSets.id,
      isFeatured: true,
      variants: [
        { size: 'S', color: 'Ivory White', colorHex: '#FDFBF7', stock: 6 },
        { size: 'M', color: 'Ivory White', colorHex: '#FDFBF7', stock: 6 },
        { size: 'L', color: 'Charcoal Black', colorHex: '#1A1A1A', stock: 6 },
        { size: 'XL', color: 'Charcoal Black', colorHex: '#1A1A1A', stock: 6 },
      ],
      images: [
        { url: '/images/products/karen-executive-set.jpg', isThumbnail: true, altText: 'Ivory Executive Blazer Set' },
      ],
    },
    {
      skuPrefix: 'LW-W-SET-02',
      name: 'Naivasha Linen Two-Piece Lounge Set',
      slug: 'naivasha-linen-two-piece-lounge-set',
      description: 'Relaxed button-down linen top with elasticated wide-leg trousers for casual weekend luxury.',
      fabricCare: '100% Organic European Linen. Machine Wash Cold.',
      basePriceKes: 6800,
      categoryId: catWomenSets.id,
      isFeatured: false,
      variants: [
        { size: 'S', color: 'Soft Sand', colorHex: '#E6E1DA', stock: 12 },
        { size: 'M', color: 'Soft Sand', colorHex: '#E6E1DA', stock: 12 },
        { size: 'L', color: 'Olive Green', colorHex: '#556B2F', stock: 12 },
      ],
      images: [
        { url: '/images/products/naivasha-linen-set.jpg', isThumbnail: true, altText: 'Soft Sand Linen Set' },
      ],
    },
    {
      skuPrefix: 'LW-W-TOP-01',
      name: 'Classic Draped Silk Blouse',
      slug: 'classic-draped-silk-blouse',
      description: 'V-neck silk blouse with delicate pleating along the shoulder seam and French cuffs.',
      fabricCare: 'Pure Mulberry Silk. Dry Clean.',
      basePriceKes: 4500,
      categoryId: catWomenTops.id,
      isFeatured: false,
      variants: [
        { size: 'XS', color: 'Cream Ivory', colorHex: '#FFFDD0', stock: 15 },
        { size: 'S', color: 'Cream Ivory', colorHex: '#FFFDD0', stock: 15 },
        { size: 'M', color: 'Blush Pink', colorHex: '#FFB6C1', stock: 15 },
        { size: 'L', color: 'Blush Pink', colorHex: '#FFB6C1', stock: 15 },
      ],
      images: [
        { url: '/images/products/silk-blouse-ivory.jpg', isThumbnail: true, altText: 'Cream Ivory Silk Blouse' },
      ],
    },
    {
      skuPrefix: 'LW-M-SHR-01',
      name: 'Kilimani Grandad Linen Shirt',
      slug: 'kilimani-grandad-linen-shirt',
      description: 'Breathable linen shirt with a minimalist mandarin collar and shell buttons.',
      fabricCare: '100% Pure Linen. Machine Wash Warm.',
      basePriceKes: 4800,
      categoryId: catMenShirts.id,
      isFeatured: true,
      variants: [
        { size: 'M', color: 'Pure White', colorHex: '#FFFFFF', stock: 15 },
        { size: 'L', color: 'Pure White', colorHex: '#FFFFFF', stock: 15 },
        { size: 'XL', color: 'Sky Blue', colorHex: '#87CEEB', stock: 15 },
        { size: 'XXL', color: 'Sky Blue', colorHex: '#87CEEB', stock: 15 },
      ],
      images: [
        { url: '/images/products/kilimani-linen-shirt.jpg', isThumbnail: true, altText: 'White Grandad Linen Shirt' },
      ],
    },
    {
      skuPrefix: 'LW-M-TRS-01',
      name: 'Pleated Tailored Linen Trousers',
      slug: 'pleated-tailored-linen-trousers',
      description: 'Single-pleated linen trousers with adjustable side tabs and a tapered hem.',
      fabricCare: 'Linen Cotton Blend. Dry Clean Preferred.',
      basePriceKes: 5500,
      categoryId: catMenTrousers.id,
      isFeatured: false,
      variants: [
        { size: '30', color: 'Beige Sand', colorHex: '#F5F5DC', stock: 10 },
        { size: '32', color: 'Beige Sand', colorHex: '#F5F5DC', stock: 10 },
        { size: '34', color: 'Charcoal Grey', colorHex: '#36454F', stock: 10 },
        { size: '36', color: 'Charcoal Grey', colorHex: '#36454F', stock: 10 },
      ],
      images: [
        { url: '/images/products/pleated-trousers-sand.jpg', isThumbnail: true, altText: 'Beige Pleated Trousers' },
      ],
    },
    {
      skuPrefix: 'LW-M-JCK-01',
      name: 'Unstructured Summer Blazer',
      slug: 'unstructured-summer-blazer',
      description: 'Lightweight unlined linen blazer with patch pockets and notch lapels.',
      fabricCare: 'Linen Viscose Blend. Dry Clean Only.',
      basePriceKes: 9800,
      categoryId: catMenOuterwear.id,
      isFeatured: true,
      variants: [
        { size: 'M', color: 'Navy Blue', colorHex: '#000080', stock: 5 },
        { size: 'L', color: 'Navy Blue', colorHex: '#000080', stock: 5 },
        { size: 'XL', color: 'Camel Brown', colorHex: '#C19A6B', stock: 5 },
      ],
      images: [
        { url: '/images/products/summer-blazer-navy.jpg', isThumbnail: true, altText: 'Navy Summer Blazer' },
      ],
    },
    {
      skuPrefix: 'LW-A-BAG-01',
      name: 'The Mara Leather Tote Bag',
      slug: 'the-mara-leather-tote-bag',
      description: 'Handcrafted full-grain Kenyan leather tote bag with suede lining and brass hardware.',
      fabricCare: '100% Full Grain Leather. Clean with Leather Conditioner.',
      basePriceKes: 14500,
      categoryId: catAccessories.id,
      isFeatured: true,
      variants: [
        { size: 'One Size', color: 'Tan Brown', colorHex: '#964B00', stock: 4 },
        { size: 'One Size', color: 'Onyx Black', colorHex: '#0F0F0F', stock: 4 },
      ],
      images: [
        { url: '/images/products/mara-leather-tote.jpg', isThumbnail: true, altText: 'Tan Leather Tote Bag' },
      ],
    },
    {
      skuPrefix: 'LW-A-BLT-01',
      name: 'Monogram Brass Buckle Leather Belt',
      slug: 'monogram-brass-buckle-leather-belt',
      description: 'Italian leather dress belt featuring a custom-cast brushed brass buckle.',
      fabricCare: '100% Genuine Leather.',
      basePriceKes: 3200,
      categoryId: catAccessories.id,
      isFeatured: false,
      variants: [
        { size: 'S/M', color: 'Black Gold', colorHex: '#000000', stock: 10 },
        { size: 'L/XL', color: 'Chestnut Gold', colorHex: '#5C4033', stock: 10 },
      ],
      images: [
        { url: '/images/products/brass-leather-belt.jpg', isThumbnail: true, altText: 'Monogram Leather Belt' },
      ],
    },
    {
      skuPrefix: 'LW-W-DRS-03',
      name: 'Westlands Cut-Out Midi Dress',
      slug: 'westlands-cut-out-midi-dress',
      description: 'Modern bodycon midi dress featuring subtle side waist cut-outs and a high neckline.',
      fabricCare: 'Stretch Double-Knit Crepe. Hand Wash Cold.',
      basePriceKes: 6500,
      categoryId: catWomenDresses.id,
      isFeatured: false,
      variants: [
        { size: 'S', color: 'Coral Red', colorHex: '#FF7F50', stock: 10 },
        { size: 'M', color: 'Coral Red', colorHex: '#FF7F50', stock: 10 },
        { size: 'L', color: 'Midnight Black', colorHex: '#121212', stock: 10 },
      ],
      images: [
        { url: '/images/products/westlands-cutout-midi.jpg', isThumbnail: true, altText: 'Coral Red Cutout Dress' },
      ],
    },
    {
      skuPrefix: 'LW-A-SCF-01',
      name: 'Pure Silk Printed Square Scarf',
      slug: 'pure-silk-printed-square-scarf',
      description: '90x90cm hand-rolled silk twill scarf with custom geometric safari artwork.',
      fabricCare: '100% Silk Twill. Dry Clean Only.',
      basePriceKes: 2800,
      categoryId: catAccessories.id,
      isFeatured: false,
      variants: [
        { size: 'One Size', color: 'Ochre Pattern', colorHex: '#CC7722', stock: 15 },
        { size: 'One Size', color: 'Azure Floral', colorHex: '#007FFF', stock: 10 },
      ],
      images: [
        { url: '/images/products/silk-printed-scarf.jpg', isThumbnail: true, altText: 'Silk Printed Scarf' },
      ],
    },
  ];

  for (const item of productsData) {
    const product = await prisma.product.upsert({
      where: { slug: item.slug },
      update: {
        description: item.description,
        basePriceKes: item.basePriceKes,
      },
      create: {
        name: item.name,
        slug: item.slug,
        description: item.description,
        fabricCare: item.fabricCare,
        basePriceKes: item.basePriceKes,
        categoryId: item.categoryId,
        isFeatured: item.isFeatured,
        isActive: true,
      },
    });

    for (const img of item.images) {
      await prisma.productImage.create({
        data: {
          productId: product.id,
          url: img.url,
          altText: img.altText,
          isThumbnail: img.isThumbnail,
        },
      });
    }

    for (const v of item.variants) {
      const sku = `${item.skuPrefix}-${v.size}-${v.color.replace(/\s+/g, '').toUpperCase()}`;

      const variant = await prisma.productVariant.upsert({
        where: { sku },
        update: {},
        create: {
          productId: product.id,
          sku,
          size: v.size,
          color: v.color,
          colorHex: v.colorHex,
          isActive: true,
        },
      });

      await prisma.inventory.upsert({
        where: { variantId: variant.id },
        update: { stockQuantity: v.stock },
        create: {
          variantId: variant.id,
          stockQuantity: v.stock,
          safetyStockThreshold: 3,
        },
      });
    }
  }

  // 5. Seed Global Store Settings
  console.log('⚙️ Seeding Store Settings...');
  await prisma.storeSetting.upsert({
    where: { key: 'delivery_fees_kes' },
    update: {},
    create: {
      key: 'delivery_fees_kes',
      value: {
        nairobi_express_kes: 300,
        greater_nairobi_kes: 400,
        nationwide_courier_kes: 500,
        free_delivery_threshold_kes: 7500,
      },
      description: 'LuxeWear Kenya delivery rates by zone and free shipping threshold',
    },
  });

  console.log('✅ LuxeWear Kenya Database Seed Completed Successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error Seeding Database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
