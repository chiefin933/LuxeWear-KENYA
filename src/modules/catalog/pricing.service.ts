import { Prisma } from '@prisma/client';
import { calculateDeliveryFee, DeliveryAddressLocation } from '../checkout/delivery-pricing.js';

export interface VariantPriceSource {
  priceOverrideKes?: Prisma.Decimal | number | string | null;
  product: {
    basePriceKes: Prisma.Decimal | number | string;
    salePriceKes?: Prisma.Decimal | number | string | null;
  };
}

export interface CartItemForPricing {
  quantity: number;
  variant: VariantPriceSource;
}

export class PricingService {
  /**
   * Calculates effective unit price for a variant as a Prisma.Decimal.
   * Priority: variant.priceOverrideKes > product.salePriceKes > product.basePriceKes
   */
  static calculateVariantUnitPrice(variant: VariantPriceSource): Prisma.Decimal {
    if (variant.priceOverrideKes !== null && variant.priceOverrideKes !== undefined) {
      return new Prisma.Decimal(variant.priceOverrideKes.toString());
    }
    if (variant.product.salePriceKes !== null && variant.product.salePriceKes !== undefined) {
      return new Prisma.Decimal(variant.product.salePriceKes.toString());
    }
    return new Prisma.Decimal(variant.product.basePriceKes.toString());
  }

  /**
   * Calculates total subtotal for line items using exact Prisma.Decimal arithmetic.
   */
  static calculateCartSubtotal(items: CartItemForPricing[]): Prisma.Decimal {
    let subtotal = new Prisma.Decimal(0);
    for (const item of items) {
      const unitPrice = this.calculateVariantUnitPrice(item.variant);
      const lineTotal = unitPrice.mul(new Prisma.Decimal(item.quantity));
      subtotal = subtotal.add(lineTotal);
    }
    return subtotal;
  }

  /**
   * Calculates delivery fee as Prisma.Decimal using exact arithmetic.
   */
  static calculateDeliveryFeeDecimal(
    subtotal: Prisma.Decimal,
    deliveryAddress: DeliveryAddressLocation
  ): Prisma.Decimal {
    const feeNumeric = calculateDeliveryFee(subtotal.toNumber(), deliveryAddress);
    return new Prisma.Decimal(feeNumeric);
  }

  /**
   * Calculates full checkout totals using exact Prisma.Decimal calculations.
   */
  static calculateCheckoutTotals(
    items: CartItemForPricing[],
    deliveryAddress: DeliveryAddressLocation
  ) {
    const subtotalKes = this.calculateCartSubtotal(items);
    const deliveryFeeKes = this.calculateDeliveryFeeDecimal(subtotalKes, deliveryAddress);
    const totalPayableKes = subtotalKes.add(deliveryFeeKes);

    return {
      subtotalKes,
      deliveryFeeKes,
      totalPayableKes,
    };
  }
}
