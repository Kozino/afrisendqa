'use strict';
/**
 * Notification adapters.
 *
 * SMS: Twilio Programmable Messaging (REST, no SDK needed).
 * Push: Expo Push API (works with the EAS-built app out of the box).
 *
 * When a provider is not configured the call is a no-op that reports
 * `delivered: false` — the caller decides whether that is fatal (OTP in
 * production IS fatal, so it throws there instead of silently failing).
 */
const { env } = require('../config/env');
const log = require('../lib/logger');
const { unavailable } = require('../lib/errors');

const smsConfigured = Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER);

async function sendSms(to, body) {
  if (!smsConfigured) {
    if (env.IS_PROD) {
      throw unavailable('SMS delivery is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER.');
    }
    // Development only: the code is printed so a developer can still log in.
    log.warn('SMS not configured — OTP not delivered (development mode)', { to });
    return { delivered: false, provider: 'none' };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: env.TWILIO_FROM_NUMBER, Body: body }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    log.error('twilio send failed', { status: response.status, message: payload.message });
    throw unavailable('Could not send the verification code. Please try again.');
  }
  return { delivered: true, provider: 'twilio', sid: payload.sid };
}

async function sendPush(pushToken, title, body, data = {}) {
  if (!pushToken) return { delivered: false, provider: 'none' };
  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ to: pushToken, title, body, data, sound: 'default' }),
    });
    return { delivered: response.ok, provider: 'expo' };
  } catch (err) {
    log.warn('push failed', { err: err.message });
    return { delivered: false, provider: 'expo' };
  }
}

const TRANSFER_TEMPLATES = {
  PAID: (t) => `AfriSend: ${t.reference} delivered. Your beneficiary received ${t.payoutFormatted}.`,
  PROCESSING: (t) => `AfriSend: ${t.reference} is on its way. Track it in the app.`,
  AML_HOLD: (t) => `AfriSend: ${t.reference} is under compliance review. We will update you within 24 hours.`,
  FAILED: (t) => `AfriSend: ${t.reference} could not be completed. Your money stays in your wallet. Ref: ${t.supportRef || t.reference}.`,
  REFUNDED: (t) => `AfriSend: ${t.reference} was refunded to your AfriSend wallet.`,
};

async function notifyTransfer(customer, transfer) {
  const template = TRANSFER_TEMPLATES[transfer.status];
  if (!template || !customer?.phone_e164) return { delivered: false };
  const body = template(transfer);
  const [device] = (await require('../db/pool').query(
    'select push_token from customer_devices where customer_id = $1 and push_token is not null order by last_seen_at desc limit 1',
    [customer.id],
  )).rows;
  await sendPush(device?.push_token, 'AfriSend update', body, { reference: transfer.reference, status: transfer.status });
  if (['PAID', 'AML_HOLD', 'FAILED', 'REFUNDED'].includes(transfer.status)) {
    return sendSms(customer.phone_e164, body);
  }
  return { delivered: true, provider: 'push' };
}

module.exports = { sendSms, sendPush, notifyTransfer, smsConfigured };
