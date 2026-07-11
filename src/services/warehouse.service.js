// Business logic layer — ครอบ transaction สำหรับใบรับ/ใบจ่าย/ใบเบิกโอน
const { pool } = require('../config/db');
const { Materials, Receipts, Issues, Stock, Transfers } = require('../models/warehouse.model');

exports.listMaterials = async (category) => (await Materials.list(pool, category)).rows;

exports.createMaterial = async (payload) => (await Materials.create(pool, payload)).rows[0];

// สร้างใบรับเข้า + รายการ (atomic) — trigger จะเพิ่ม warehouse_stock ให้เอง
exports.createReceipt = async (payload) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const receipt = (await Receipts.insert(client, payload)).rows[0];
    const items = [];
    for (const it of payload.items) {
      items.push((await Receipts.insertItem(client, receipt.receipt_id, it)).rows[0]);
    }
    await client.query('COMMIT');
    return { ...receipt, items };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

exports.listReceipts = async () => (await Receipts.list()).rows;

exports.getReceipt = async (id) => {
  const receipt = (await Receipts.getById(pool, id)).rows[0];
  if (!receipt) return null;
  const items = (await Receipts.itemsByReceipt(pool, id)).rows;
  return { ...receipt, items };
};

// สร้างใบจ่ายออก + รายการ (atomic) — trigger จะลด stock และ throw ถ้าไม่พอ
exports.createIssue = async (payload) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const issue = (await Issues.insert(client, payload)).rows[0];
    const items = [];
    for (const it of payload.items) {
      items.push((await Issues.insertItem(client, issue.issue_id, it)).rows[0]);
    }
    await client.query('COMMIT');
    return { ...issue, items };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

exports.listIssues = async () => (await Issues.list()).rows;

exports.getIssue = async (id) => {
  const issue = (await Issues.getById(pool, id)).rows[0];
  if (!issue) return null;
  const items = (await Issues.itemsByIssue(pool, id)).rows;
  return { ...issue, items };
};

exports.listStock = async () => (await Stock.list()).rows;

exports.listStoreStock = async () => (await Stock.listStore()).rows;

// สร้างใบเบิกโอน + รายการ (atomic) — trigger ย้ายของระหว่างคลังและ throw ถ้าไม่พอ
exports.createTransfer = async (payload) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const transfer = (await Transfers.insert(client, payload)).rows[0];
    const items = [];
    for (const it of payload.items) {
      items.push((await Transfers.insertItem(client, transfer.transfer_id, it)).rows[0]);
    }
    await client.query('COMMIT');
    return { ...transfer, items };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

exports.listTransfers = async () => (await Transfers.list()).rows;

exports.getTransfer = async (id) => {
  const transfer = (await Transfers.getById(pool, id)).rows[0];
  if (!transfer) return null;
  const items = (await Transfers.itemsByTransfer(pool, id)).rows;
  return { ...transfer, items };
};
