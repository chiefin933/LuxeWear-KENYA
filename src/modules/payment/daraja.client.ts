import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

export interface StkPushRequestOptions {
  phoneNumber: string; // Formatted as 2547XXXXXXXX or 2541XXXXXXXX
  amount: number;
  accountReference: string;
  transactionDesc: string;
  callbackUrl?: string;
}

export interface StkPushResponse {
  merchantRequestId: string;
  checkoutRequestId: string;
  responseCode: string;
  responseDescription: string;
  customerMessage: string;
}

export class DarajaClient {
  private cachedToken: string | null = null;
  private tokenExpiresAt: number = 0;

  /**
   * Normalize any valid Kenyan phone number to 2547XXXXXXXX or 2541XXXXXXXX
   */
  public static normalizePhoneNumber(phone: string): string {
    const cleaned = phone.replace(/[^0-9+]/g, '');
    
    if (/^254(7|1)\d{8}$/.test(cleaned)) {
      return cleaned;
    }
    if (/^\+254(7|1)\d{8}$/.test(cleaned)) {
      return cleaned.substring(1);
    }
    if (/^0(7|1)\d{8}$/.test(cleaned)) {
      return `254${cleaned.substring(1)}`;
    }
    if (/^(7|1)\d{8}$/.test(cleaned)) {
      return `254${cleaned}`;
    }

    throw new Error(`Invalid Kenyan phone number format: '${phone}'. Must start with 07, 01, 254, or +254.`);
  }

  /**
   * Formats current timestamp into YYYYMMDDHHmmss required by Safaricom
   */
  public static getTimestamp(): string {
    const now = new Date();
    const YYYY = now.getFullYear();
    const MM = String(now.getMonth() + 1).padStart(2, '0');
    const DD = String(now.getDate()).padStart(2, '0');
    const HH = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `${YYYY}${MM}${DD}${HH}${mm}${ss}`;
  }

  /**
   * Generates Base64 encoded password for Daraja STK Push
   */
  public static generatePassword(shortcode: string, passkey: string, timestamp: string): string {
    return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
  }

  /**
   * Get OAuth Bearer Access Token from Safaricom Daraja
   */
  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt - 60000) {
      return this.cachedToken;
    }

    const authHeader = Buffer.from(
      `${env.DARAJA_CONSUMER_KEY}:${env.DARAJA_CONSUMER_SECRET}`
    ).toString('base64');

    const baseUrl =
      env.DARAJA_ENV === 'production'
        ? 'https://api.safaricom.co.ke'
        : 'https://sandbox.safaricom.co.ke';

    const url = `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Basic ${authHeader}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Daraja OAuth token request failed [${response.status}]: ${errorText}`);
      }

      const data = (await response.json()) as { access_token: string; expires_in: string };
      this.cachedToken = data.access_token;
      this.tokenExpiresAt = Date.now() + parseInt(data.expires_in, 10) * 1000;
      return this.cachedToken;
    } catch (error) {
      logger.error('Failed to authenticate with Daraja API', { error });
      throw error;
    }
  }

  /**
   * Initiates STK Push prompt on customer phone
   */
  public async initiateStkPush(options: StkPushRequestOptions): Promise<StkPushResponse> {
    // Check for mock environment mode or test execution
    if (
      env.DARAJA_ENV === 'mock' ||
      process.env.NODE_ENV === 'test' ||
      env.DARAJA_CONSUMER_KEY === 'mock_consumer_key'
    ) {
      const mockTimestamp = Date.now();
      const merchantRequestId = `MOCK-MR-${mockTimestamp}-${Math.floor(1000 + Math.random() * 9000)}`;
      const checkoutRequestId = `ws_CO_${mockTimestamp}_${Math.floor(10000 + Math.random() * 90000)}`;

      logger.info('Simulated M-Pesa Daraja STK Push (Mock Mode)', {
        phone: options.phoneNumber,
        amount: options.amount,
        merchantRequestId,
        checkoutRequestId,
      });

      return {
        merchantRequestId,
        checkoutRequestId,
        responseCode: '0',
        responseDescription: 'Success. Request accepted for processing',
        customerMessage: `STK Push sent to ${options.phoneNumber}. Please enter your M-Pesa PIN to complete payment of KES ${options.amount.toLocaleString()}.`,
      };
    }

    const token = await this.getAccessToken();
    const timestamp = DarajaClient.getTimestamp();
    const password = DarajaClient.generatePassword(
      env.DARAJA_SHORTCODE,
      env.DARAJA_PASSKEY,
      timestamp
    );

    const baseUrl =
      env.DARAJA_ENV === 'production'
        ? 'https://api.safaricom.co.ke'
        : 'https://sandbox.safaricom.co.ke';

    const url = `${baseUrl}/mpesa/stkpush/v1/processrequest`;
    const callbackUrl = options.callbackUrl || env.DARAJA_CALLBACK_URL;

    const payload = {
      BusinessShortCode: env.DARAJA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(options.amount),
      PartyA: options.phoneNumber,
      PartyB: env.DARAJA_SHORTCODE,
      PhoneNumber: options.phoneNumber,
      CallBackURL: callbackUrl,
      AccountReference: options.accountReference,
      TransactionDesc: options.transactionDesc,
    };

    logger.info('Sending STK Push request to Safaricom Daraja', {
      phone: options.phoneNumber,
      amount: options.amount,
      url,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Daraja STK Push HTTP error', { status: response.status, body: errorText });
      throw new Error(`Daraja STK Push failed with HTTP ${response.status}: ${errorText}`);
    }

    const resJson = (await response.json()) as {
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResponseCode: string;
      ResponseDescription: string;
      CustomerMessage: string;
    };

    return {
      merchantRequestId: resJson.MerchantRequestID,
      checkoutRequestId: resJson.CheckoutRequestID,
      responseCode: resJson.ResponseCode,
      responseDescription: resJson.ResponseDescription,
      customerMessage: resJson.CustomerMessage,
    };
  }
}

export const darajaClient = new DarajaClient();
