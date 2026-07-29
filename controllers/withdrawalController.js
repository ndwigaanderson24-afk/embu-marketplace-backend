// controllers/withdrawalController.js

const Withdrawal = require('../models/withdrawal');
const Order = require('../models/order');
const { sendSuccess, sendError } = require('../helpers');

const MIN_WITHDRAWAL_AMOUNT = 800;

// GET /api/withdrawals/balance  (protected, requireActiveSeller)
exports.getBalance = async (req, res) => {
  const payable = await Order.sumPayableEarnings(req.user.id);
  const pending = await Order.sumPendingEarnings(req.user.id);
  const committed = await Withdrawal.sumCommittedBySeller(req.user.id);
  const available = Math.max(0, payable - committed);
  return sendSuccess(res, 200, 'Balance retrieved.', {
    payable_from_completed_orders: payable,
    pending_from_in_progress_orders: pending,
    already_withdrawn_or_pending: committed,
    available_balance: available,
    minimum_withdrawal: MIN_WITHDRAWAL_AMOUNT
  });
};

// POST /api/withdrawals  (protected, requireActiveSeller)
exports.request = async (req, res) => {
  const { amount, method, bank_details, mpesa_number } = req.body;
  const numAmount = Number(amount);

  if (!numAmount || numAmount <= 0) return sendError(res, 400, 'A valid amount is required.');
  if (numAmount < MIN_WITHDRAWAL_AMOUNT) return sendError(res, 400, `Minimum withdrawal is KES ${MIN_WITHDRAWAL_AMOUNT}.`);
  if (!['bank_transfer', 'mpesa'].includes(method)) return sendError(res, 400, 'method must be bank_transfer or mpesa.');
  if (method === 'mpesa' && !mpesa_number) return sendError(res, 400, 'mpesa_number is required for M-Pesa withdrawals.');
  if (method === 'bank_transfer' && !bank_details) return sendError(res, 400, 'bank_details is required for bank transfers.');

  const payable = await Order.sumPayableEarnings(req.user.id);
  const committed = await Withdrawal.sumCommittedBySeller(req.user.id);
  const available = payable - committed;
  if (numAmount > available) return sendError(res, 400, `Insufficient balance. Available: KES ${available}.`);

  const id = await Withdrawal.create(req.user.id, { amount: numAmount, method, bank_details, mpesa_number });
  return sendSuccess(res, 201, 'Withdrawal request submitted. Processing takes 24-48 hours.', { id, amount: numAmount, status: 'pending' });
};

// GET /api/withdrawals/mine  (protected, requireActiveSeller)
exports.getMine = async (req, res) => {
  const withdrawals = await Withdrawal.findBySeller(req.user.id);
  return sendSuccess(res, 200, 'Withdrawals retrieved.', { withdrawals });
};

// ---------- Admin ----------

// GET /api/withdrawals/admin/all
exports.adminGetAll = async (req, res) => {
  const withdrawals = await Withdrawal.findAll(req.query);
  return sendSuccess(res, 200, 'Withdrawals retrieved.', { withdrawals });
};

// PUT /api/withdrawals/admin/:id/status  { status, reference_number?, notes? }
exports.adminUpdateStatus = async (req, res) => {
  const { status, reference_number, notes } = req.body;
  const valid = ['pending', 'processing', 'completed', 'failed'];
  if (!valid.includes(status)) return sendError(res, 400, `status must be one of: ${valid.join(', ')}`);

  const withdrawal = await Withdrawal.findById(req.params.id);
  if (!withdrawal) return sendError(res, 404, 'Withdrawal not found.');

  await Withdrawal.updateStatus(req.params.id, status, { reference_number, notes });
  return sendSuccess(res, 200, `Withdrawal marked as ${status}.`);
};
