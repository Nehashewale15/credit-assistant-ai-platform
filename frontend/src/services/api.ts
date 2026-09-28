import type {
  FinancialProfile,
  DashboardData,
  AIAnalysis,
  ProgressData,
  InsightItem,
  ScoreHistoryItem,
  UtilizationBreakdown,
  SnapshotDelta
} from '../types';

const API_BASE = '/api';

function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem('ca_auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Helper calculation functions for client fallback
function calculateDTI(debt: number, income: number): number {
  if (income <= 0) return 0;
  return Number(((debt / income) * 100).toFixed(1));
}

function calculateUtilization(outstanding: number, limit: number): number {
  if (limit <= 0) return 0;
  return Number(((outstanding / limit) * 100).toFixed(1));
}

function calculateAvailableCredit(limit: number, outstanding: number): number {
  return Math.max(0, Number((limit - outstanding).toFixed(2)));
}

function generateInsightsFallback(profile: FinancialProfile | null, scoreHistory: ScoreHistoryItem[] = []): InsightItem[] {
  if (!profile) {
    return [
      {
        id: 'no_profile',
        title: 'Complete Your Financial Profile',
        why_it_matters: 'Financial metrics provide clarity on your debt capacity and credit health.',
        simple_explanation: 'You have not completed your financial setup yet.',
        suggested_action: 'Fill in your income, credit limit, and current debt details to unlock customized credit insights.',
        severity: 'info'
      }
    ];
  }

  const dti = calculateDTI(profile.monthly_debt, profile.monthly_income);
  const util = calculateUtilization(profile.outstanding_credit, profile.credit_limit);
  const insights: InsightItem[] = [];

  // Utilization
  if (util >= 70) {
    insights.push({
      id: 'util_critical',
      title: 'High Revolving Credit Utilization',
      why_it_matters: 'High revolving utilization (above 70%) signals potential over-reliance on credit to lenders.',
      simple_explanation: `Your reported credit utilization is currently ${util}%, which is significantly above recommended guidelines.`,
      suggested_action: 'Consider making partial repayments to bring utilization below 30% of your total credit limit.',
      severity: 'critical'
    });
  } else if (util >= 30) {
    insights.push({
      id: 'util_warning',
      title: 'Moderate Credit Utilization',
      why_it_matters: 'Keeping credit utilization below 30% helps maintain positive credit health indicators.',
      simple_explanation: `Your credit utilization is ${util}%. Staying lower reduces monthly finance charges.`,
      suggested_action: 'Aim to lower outstanding card balances or avoid high single-transaction card purchases.',
      severity: 'warning'
    });
  } else {
    insights.push({
      id: 'util_good',
      title: 'Healthy Credit Utilization Level',
      why_it_matters: 'Low credit utilization (<30%) demonstrates prudent credit usage to financial institutions.',
      simple_explanation: `Your utilization is ${util}%, which is within healthy educational parameters.`,
      suggested_action: 'Maintain this habit by paying full balance before statement due dates.',
      severity: 'info'
    });
  }

  // DTI
  if (dti >= 50) {
    insights.push({
      id: 'dti_critical',
      title: 'Elevated Debt-to-Income (DTI) Ratio',
      why_it_matters: 'A DTI over 50% means more than half of your gross income goes toward existing EMIs and obligations.',
      simple_explanation: `Your current DTI is ${dti}%. High fixed debt leaves limited cash flow for essentials and savings.`,
      suggested_action: 'Focus on snowball/avalanche debt reduction strategies or avoid taking on new loans.',
      severity: 'critical'
    });
  } else if (dti >= 35) {
    insights.push({
      id: 'dti_warning',
      title: 'Moderate Debt Burden',
      why_it_matters: 'A DTI between 35% and 50% indicates moderate monthly financial commitments.',
      simple_explanation: `Your monthly EMI obligations represent ${dti}% of your monthly income (₹${profile.monthly_debt.toLocaleString('en-IN')} of ₹${profile.monthly_income.toLocaleString('en-IN')}).`,
      suggested_action: 'Prioritize high-interest loans for prepayment when extra funds become available.',
      severity: 'warning'
    });
  } else {
    insights.push({
      id: 'dti_good',
      title: 'Balanced Debt-to-Income Ratio',
      why_it_matters: 'A low DTI ratio provides strong financial flexibility and emergency savings capability.',
      simple_explanation: `Only ${dti}% of your income is allocated to debt payments.`,
      suggested_action: 'Continue allocating surplus funds toward emergency reserves and long-term goals.',
      severity: 'info'
    });
  }

  // Missed payments
  if (profile.missed_payments > 0) {
    insights.push({
      id: 'missed_payments_alert',
      title: 'Recent Missed Payment Record',
      why_it_matters: 'Timely payment history is one of the most vital factors in long-term credit discipline.',
      simple_explanation: `You reported ${profile.missed_payments} missed or delayed payment(s) in recent periods.`,
      suggested_action: 'Set up automated mandate payments (NACH / Auto-debit) to avoid missing future due dates.',
      severity: profile.missed_payments > 1 ? 'critical' : 'warning'
    });
  }

  // Score History Trend
  if (scoreHistory.length >= 2) {
    const latest = scoreHistory[scoreHistory.length - 1].score;
    const prev = scoreHistory[scoreHistory.length - 2].score;
    const diff = latest - prev;
    if (diff < -15) {
      insights.push({
        id: 'score_declining',
        title: 'Recent Credit Score Decline Detected',
        why_it_matters: 'Understanding score changes helps identify recent credit events.',
        simple_explanation: `Your score decreased by ${Math.abs(diff)} points (from ${prev} to ${latest}).`,
        suggested_action: 'Review recent credit card utilization changes or billing statement dates.',
        severity: 'warning'
      });
    } else if (diff > 10) {
      insights.push({
        id: 'score_improving',
        title: 'Positive Score Trajectory',
        why_it_matters: 'Consistently improving credit habits build long-term financial health.',
        simple_explanation: `Your recorded score increased by +${diff} points over the previous period.`,
        suggested_action: 'Keep maintaining timely repayments and low revolving balances.',
        severity: 'info'
      });
    }
  }

  return insights;
}

// Client-Side Offline / GitHub Pages Storage Engine
const localStorageEngine = {
  getCurrentUser() {
    const raw = localStorage.getItem('ca_current_user');
    return raw ? JSON.parse(raw) : null;
  },

  setCurrentUser(user: { id: number; name: string; email: string; created_at: string }) {
    localStorage.setItem('ca_current_user', JSON.stringify(user));
  },

  getProfile(): FinancialProfile | null {
    const raw = localStorage.getItem('ca_profile');
    return raw ? JSON.parse(raw) : null;
  },

  setProfile(p: FinancialProfile): FinancialProfile {
    const updated: FinancialProfile = {
      ...p,
      id: p.id || 1,
      user_id: p.user_id || 1,
      dti: calculateDTI(p.monthly_debt, p.monthly_income),
      utilization: calculateUtilization(p.outstanding_credit, p.credit_limit),
      available_credit: calculateAvailableCredit(p.credit_limit, p.outstanding_credit),
      updated_at: new Date().toISOString()
    };
    localStorage.setItem('ca_profile', JSON.stringify(updated));

    // Record snapshot
    const snapshots = localStorageEngine.getSnapshots();
    const newSnap: ScoreHistoryItem = {
      id: Date.now(),
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      score: updated.credit_score,
      dti: updated.dti!,
      utilization: updated.utilization!,
      debt: updated.monthly_debt
    };
    snapshots.push(newSnap);
    localStorage.setItem('ca_snapshots', JSON.stringify(snapshots));

    return updated;
  },

  getSnapshots(): ScoreHistoryItem[] {
    const raw = localStorage.getItem('ca_snapshots');
    if (!raw) return [];
    return JSON.parse(raw);
  },

  seedAaravDemo() {
    const user = {
      id: 99,
      name: 'Aarav Sharma',
      email: 'aarav@example.com',
      created_at: new Date().toISOString()
    };
    localStorageEngine.setCurrentUser(user);

    const profile: FinancialProfile = {
      id: 99,
      user_id: 99,
      credit_score: 650,
      monthly_income: 40000,
      monthly_expenses: 15000,
      monthly_debt: 10000,
      credit_limit: 100000,
      outstanding_credit: 60000,
      missed_payments: 1,
      financial_goal: 'Reduce debt',
      dti: 25.0,
      utilization: 60.0,
      available_credit: 40000.0,
      updated_at: new Date().toISOString()
    };
    localStorage.setItem('ca_profile', JSON.stringify(profile));

    const demoSnapshots: ScoreHistoryItem[] = [
      { id: 1, date: 'Jan 15', score: 620, dti: 30.0, utilization: 70.0, debt: 12000 },
      { id: 2, date: 'Feb 15', score: 635, dti: 27.5, utilization: 65.0, debt: 11000 },
      { id: 3, date: 'Mar 15', score: 650, dti: 25.0, utilization: 60.0, debt: 10000 }
    ];
    localStorage.setItem('ca_snapshots', JSON.stringify(demoSnapshots));

    return user;
  }
};

export const api = {
  // Auth
  register: async (name: string, email: string, password: string) => {
    try {
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // Backend unavailable (GitHub Pages static host) -> use local storage engine fallback
    }

    const token = `token_user_${Date.now()}`;
    const newUser = { id: Date.now(), name, email, created_at: new Date().toISOString() };
    localStorageEngine.setCurrentUser(newUser);

    return {
      access_token: token,
      user_name: name,
      user_email: email
    };
  },

  login: async (email: string, password: string) => {
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // Backend unavailable -> fallback
    }

    let user = localStorageEngine.getCurrentUser();
    if (!user || user.email !== email) {
      const nameFromEmail = email.split('@')[0];
      const formattedName = nameFromEmail.charAt(0).toUpperCase() + nameFromEmail.slice(1);
      user = { id: Date.now(), name: formattedName, email, created_at: new Date().toISOString() };
      localStorageEngine.setCurrentUser(user);
    }

    return {
      access_token: `token_user_${Date.now()}`,
      user_name: user.name,
      user_email: user.email
    };
  },

  demoLogin: async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/demo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // Backend unavailable -> fallback
    }

    const user = localStorageEngine.seedAaravDemo();
    return {
      access_token: 'demo_token_aarav',
      user_name: user.name,
      user_email: user.email
    };
  },

  getMe: async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/me`, {
        headers: getAuthHeader(),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // Backend unavailable -> fallback
    }

    let user = localStorageEngine.getCurrentUser();
    if (!user) {
      user = { id: 1, name: 'User', email: 'user@example.com', created_at: new Date().toISOString() };
      localStorageEngine.setCurrentUser(user);
    }
    return user;
  },

  // Financial Profile
  getProfile: async () => {
    try {
      const res = await fetch(`${API_BASE}/financial-profile`, {
        headers: getAuthHeader(),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // Backend unavailable -> fallback
    }

    const p = localStorageEngine.getProfile();
    if (!p) {
      throw new Error('Financial profile not found');
    }
    return p;
  },

  saveProfile: async (profileData: FinancialProfile, isEdit: boolean = false) => {
    try {
      const method = isEdit ? 'PUT' : 'POST';
      const res = await fetch(`${API_BASE}/financial-profile`, {
        method: method,
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader(),
        },
        body: JSON.stringify(profileData),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // Backend unavailable -> fallback
    }

    return localStorageEngine.setProfile(profileData);
  },

  // Dashboard
  getDashboard: async () => {
    try {
      const res = await fetch(`${API_BASE}/dashboard`, {
        headers: getAuthHeader(),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // Backend unavailable -> fallback
    }

    const user = localStorageEngine.getCurrentUser() || { name: 'User' };
    const profile = localStorageEngine.getProfile();
    const snapshots = localStorageEngine.getSnapshots();

    if (!profile) {
      return {
        user_name: user.name,
        has_profile: false,
        score_history: snapshots,
        insights: generateInsightsFallback(null, snapshots)
      } as DashboardData;
    }

    const dti = calculateDTI(profile.monthly_debt, profile.monthly_income);
    const utilization = calculateUtilization(profile.outstanding_credit, profile.credit_limit);
    const available = calculateAvailableCredit(profile.credit_limit, profile.outstanding_credit);

    const utilBreakdown: UtilizationBreakdown = {
      credit_limit: profile.credit_limit,
      used_credit: profile.outstanding_credit,
      available_credit: available,
      utilization_percentage: utilization
    };

    let delta: SnapshotDelta | undefined = undefined;
    if (snapshots.length >= 2) {
      const prev = snapshots[snapshots.length - 2];
      const diff = profile.credit_score - prev.score;
      delta = {
        score_change: diff,
        score_change_text: diff > 0 ? `+${diff}` : `${diff}`,
        utilization_change: Number((utilization - prev.utilization).toFixed(1)),
        dti_change: Number((dti - prev.dti).toFixed(1)),
        debt_change: Number((profile.monthly_debt - prev.debt).toFixed(2))
      };
    }

    return {
      user_name: user.name,
      has_profile: true,
      credit_score: profile.credit_score,
      utilization: utilization,
      dti: dti,
      monthly_debt: profile.monthly_debt,
      available_credit: available,
      financial_goal: profile.financial_goal,
      score_history: snapshots,
      utilization_breakdown: utilBreakdown,
      insights: generateInsightsFallback(profile, snapshots),
      delta: delta
    } as DashboardData;
  },

  // Progress
  getProgress: async () => {
    try {
      const res = await fetch(`${API_BASE}/progress`, {
        headers: getAuthHeader(),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // Backend unavailable -> fallback
    }

    const profile = localStorageEngine.getProfile();
    const snapshots = localStorageEngine.getSnapshots();

    let delta: SnapshotDelta | undefined = undefined;
    if (profile && snapshots.length >= 2) {
      const prev = snapshots[snapshots.length - 2];
      const dti = calculateDTI(profile.monthly_debt, profile.monthly_income);
      const utilization = calculateUtilization(profile.outstanding_credit, profile.credit_limit);
      const diff = profile.credit_score - prev.score;
      delta = {
        score_change: diff,
        score_change_text: diff > 0 ? `+${diff}` : `${diff}`,
        utilization_change: Number((utilization - prev.utilization).toFixed(1)),
        dti_change: Number((dti - prev.dti).toFixed(1)),
        debt_change: Number((profile.monthly_debt - prev.debt).toFixed(2))
      };
    }

    return {
      snapshots_count: snapshots.length,
      history: snapshots,
      delta: delta,
      current_score: profile?.credit_score,
      current_utilization: profile ? calculateUtilization(profile.outstanding_credit, profile.credit_limit) : undefined,
      current_dti: profile ? calculateDTI(profile.monthly_debt, profile.monthly_income) : undefined,
      current_debt: profile?.monthly_debt
    } as ProgressData;
  },

  // AI Advisor
  getAIAnalysis: async (forceRefresh: boolean = false) => {
    try {
      const res = await fetch(`${API_BASE}/ai/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader(),
        },
        body: JSON.stringify({ force_refresh: forceRefresh }),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // Backend unavailable -> fallback
    }

    const user = localStorageEngine.getCurrentUser() || { name: 'User' };
    const profile = localStorageEngine.getProfile();

    if (!profile) {
      throw new Error('Please complete your financial profile before requesting an AI credit analysis.');
    }

    const dti = calculateDTI(profile.monthly_debt, profile.monthly_income);
    const util = calculateUtilization(profile.outstanding_credit, profile.credit_limit);
    const available = calculateAvailableCredit(profile.credit_limit, profile.outstanding_credit);

    return {
      summary: `Hello ${user.name}, your self-reported credit score is ${profile.credit_score} with a Debt-to-Income (DTI) ratio of ${dti}% and credit utilization of ${util}%. Your available revolving credit buffer is ₹${available.toLocaleString('en-IN')}.`,
      key_factors: [
        `Revolving Credit Utilization is currently at ${util}% (Limit: ₹${profile.credit_limit.toLocaleString('en-IN')}, Used: ₹${profile.outstanding_credit.toLocaleString('en-IN')}).`,
        `Debt-to-Income Ratio stands at ${dti}% with monthly EMI commitments of ₹${profile.monthly_debt.toLocaleString('en-IN')} out of ₹${profile.monthly_income.toLocaleString('en-IN')} income.`,
        `Repayment History: ${profile.missed_payments} missed payment(s) reported in recent billing cycles.`
      ],
      action_plan: [
        `Step 1: Reduce Revolving Balances – Focus on paying down high card balances to lower your utilization from ${util}% toward the recommended 30% threshold.`,
        `Step 2: Automate Monthly EMIs – Set up Auto-Debit / NACH mandates for all recurring payments to avoid accidental late fees or reported delays.`,
        `Step 3: Restructure Fixed Debt – Focus surplus income on reducing your ₹${profile.monthly_debt.toLocaleString('en-IN')} monthly debt payments to lower your DTI ratio below 35%.`,
        `Step 4: Avoid Unnecessary Credit Inquiries – Refrain from applying for multiple new credit cards or loans simultaneously within short time windows.`,
        `Step 5: Track Monthly Snapshots – Regularly update your income and debt figures on Credit Assistant to monitor your financial metrics over time.`
      ],
      explanation: `Educational Guidance Overview:\n\nIn the Indian financial context, managing revolving credit and debt ratios effectively is fundamental to maintaining a healthy financial standing. Your current credit utilization of ${util}% represents the percentage of borrowing capacity currently active. Lowering this ratio below 30% demonstrates strong financial liquidity.\n\nFurthermore, your Debt-to-Income ratio of ${dti}% indicates that ₹${profile.monthly_debt.toLocaleString('en-IN')} of your monthly gross income (₹${profile.monthly_income.toLocaleString('en-IN')}) is pledged toward debt service. Lowering your fixed EMI commitments provides a safer financial cushion for unexpected expenses and savings.\n\nDisclaimer: Credit Assistant provides educational financial information for self-monitoring purposes. It does not calculate official CIBIL credit scores or provide regulated investment advice.`
    } as AIAnalysis;
  },

  askAIChat: async (question: string) => {
    try {
      const res = await fetch(`${API_BASE}/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader(),
        },
        body: JSON.stringify({ question }),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // Backend unavailable -> fallback
    }

    const profile = localStorageEngine.getProfile();
    const dti = profile ? calculateDTI(profile.monthly_debt, profile.monthly_income) : 0;
    const util = profile ? calculateUtilization(profile.outstanding_credit, profile.credit_limit) : 0;
    const qLower = question.toLowerCase();

    let answer = '';
    if (qLower.includes('utilization')) {
      answer = `Credit utilization is the percentage of your credit limit that you are currently using. ${profile ? `Your current utilization is ${util}% (₹${profile.outstanding_credit.toLocaleString('en-IN')} used of ₹${profile.credit_limit.toLocaleString('en-IN')} limit).` : ''} Financial experts in India generally recommend keeping your credit card utilization below 30%.`;
    } else if (qLower.includes('dti') || qLower.includes('debt to income')) {
      answer = `Debt-to-Income (DTI) ratio measures what percentage of your monthly gross income goes toward debt payments (EMIs, credit cards). ${profile ? `Your current DTI is ${dti}%.` : ''} A DTI under 35% is considered healthy, while a DTI above 50% indicates heavy debt commitments.`;
    } else if (qLower.includes('reduce debt') || qLower.includes('pay off')) {
      answer = `To reduce debt effectively: 1) Focus on paying high-interest credit card debt first (Avalanche method). 2) Consider consolidating multiple small loans. 3) Avoid creating new debt obligations until your DTI is below 35%.`;
    } else if (qLower.includes('time') || qLower.includes('missed')) {
      answer = `Paying your bills on time is one of the single most influential habits for long-term credit health. Setting up auto-debit mandates (NACH) ensures you never miss a statement due date.`;
    } else {
      answer = `Managing credit health involves keeping credit utilization below 30%, maintaining a DTI below 35%, and paying all billing statements on time. ${profile ? `Based on your profile, your DTI is ${dti}% and utilization is ${util}%.` : ''} Please consult a certified financial planner for specific regulated financial advice.`;
    }

    return { question, answer };
  },
};
