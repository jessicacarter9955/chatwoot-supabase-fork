import { formatStripeAmount } from '../stripeHelper';

const formatUsd = (amount, digits) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount);

describe('formatStripeAmount', () => {
  it('preserves fractional minor units for subscription prices', () => {
    expect(formatStripeAmount('0.05', 'USD', { preservePrecision: true })).toBe(
      formatUsd(0.0005, 4)
    );
    expect(
      formatStripeAmount('0.000000000001', 'USD', { preservePrecision: true })
    ).toBe(formatUsd(0.00000000000001, 14));
  });

  it('keeps standard invoice precision and trims insignificant price zeros', () => {
    expect(formatStripeAmount(1000, 'USD')).toBe(formatUsd(10, 2));
    expect(
      formatStripeAmount('1000.00', 'USD', { preservePrecision: true })
    ).toBe(formatUsd(10, 2));
  });

  it('uses two-decimal API units for UGX', () => {
    expect(formatStripeAmount(5000, 'UGX')).toBe(
      new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'UGX',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(50)
    );
  });
});
