// ── Parent Insights: Scoring Engine ────────────────────────────────────────
// Consistency Score, Responsibility Score, Planning Horizon
// All functions are pure — pass `now` as a Date for testability.

// ── Shared utilities ────────────────────────────────────────────────────────

function _withinWindow(docs, tsField, now, days) {
  var cutoff = new Date(now.getTime() - days * 864e5);
  return docs.filter(function(d) {
    var ts = d[tsField];
    var dt = ts && ts.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
    return dt && dt >= cutoff && dt <= now;
  });
}

function _isoWeekKey(date) {
  var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  var day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  var week = Math.ceil(((d - yearStart) / 864e5 + 1) / 7);
  return d.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
}

function _stdDev(vals) {
  if (!vals.length) return 0;
  var mean = vals.reduce(function(a, b) { return a + b; }, 0) / vals.length;
  var variance = vals.reduce(function(s, v) { return s + Math.pow(v - mean, 2); }, 0) / vals.length;
  return Math.sqrt(variance);
}

function _median(vals) {
  if (!vals.length) return 0;
  var sorted = vals.slice().sort(function(a, b) { return a - b; });
  var mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function _toDate(ts) {
  if (!ts) return null;
  return ts.toDate ? ts.toDate() : new Date(ts);
}

function _isGracePeriod(completions, plans, spending, now, graceDays) {
  graceDays = graceDays || 14;
  var allTs = [];
  completions.forEach(function(d) { var dt = _toDate(d.submittedAt); if (dt) allTs.push(dt); });
  plans.forEach(function(d) { var dt = _toDate(d.createdAt); if (dt) allTs.push(dt); });
  spending.forEach(function(d) { var dt = _toDate(d.spentAt); if (dt) allTs.push(dt); });
  if (!allTs.length) return true;
  var earliest = new Date(Math.min.apply(null, allTs));
  return (now - earliest) < graceDays * 864e5;
}

function _bandLabel(score, bands) {
  for (var i = 0; i < bands.length; i++) {
    if (score <= bands[i].max) return bands[i].label;
  }
  return bands[bands.length - 1].label;
}

// ── Score 1: Consistency ────────────────────────────────────────────────────

/**
 * @param {Array}  completions  Firestore docs from completions collection
 * @param {Array}  plans        Firestore docs from plans collection
 * @param {Date}   now
 * @returns {{ score, band, breakdown, reason }}
 */
function calculateConsistencyScore(completions, plans, now) {
  var WINDOW = 90;
  var WEEKS_IN_WINDOW = 13;

  if (_isGracePeriod(completions, plans, [], now)) {
    return { score: null, band: null, breakdown: {}, reason: 'insufficient_data' };
  }

  // Non-rejected completions within window
  var active = _withinWindow(completions, 'submittedAt', now, WINDOW)
    .filter(function(c) { return c.status !== 'rejected'; });

  // ── Sub-score A: active weeks ratio ──
  var weekSet = {};
  active.forEach(function(c) {
    var dt = _toDate(c.submittedAt);
    if (dt) weekSet[_isoWeekKey(dt)] = true;
  });
  var activeWeeks = Object.keys(weekSet).length;
  var sA = activeWeeks / WEEKS_IN_WINDOW;

  // ── Sub-score B: gap regularity ──
  var dates = active.map(function(c) { return _toDate(c.submittedAt); })
    .filter(Boolean).sort(function(a, b) { return a - b; });
  var sB;
  if (dates.length < 3) {
    sB = 0.5;
  } else {
    var gaps = [];
    for (var i = 1; i < dates.length; i++) {
      gaps.push((dates[i] - dates[i - 1]) / 864e5);
    }
    var meanGap = gaps.reduce(function(a, b) { return a + b; }, 0) / gaps.length;
    var cv = meanGap > 0 ? _stdDev(gaps) / meanGap : 1;
    sB = _clamp(1 - cv / 2, 0, 1);
  }

  // ── Sub-score C: planner usage ──
  // Include plans within window + 14 days ahead
  var plansCutoff = new Date(now.getTime() - WINDOW * 864e5);
  var plansAhead = new Date(now.getTime() + 14 * 864e5);
  var relevantPlans = plans.filter(function(p) {
    var ws = _toDate(p.weekStart) || (p.weekStart ? new Date(p.weekStart) : null);
    return ws && ws >= plansCutoff && ws <= plansAhead;
  });
  var planWeekSet = {};
  relevantPlans.forEach(function(p) {
    var ws = _toDate(p.weekStart) || new Date(p.weekStart);
    if (ws) planWeekSet[_isoWeekKey(ws)] = true;
  });
  var weeksWithPlan = Object.keys(planWeekSet).length;
  var advancePlans = relevantPlans.filter(function(p) {
    var ws = _toDate(p.weekStart) || new Date(p.weekStart);
    var ca = _toDate(p.createdAt);
    return ws && ca && (ws - ca) > 864e5; // > 1 day ahead
  });
  var advanceRatio = relevantPlans.length > 0 ? advancePlans.length / relevantPlans.length : 0;
  var sC = _clamp((weeksWithPlan / WEEKS_IN_WINDOW) * (0.7 + 0.3 * advanceRatio), 0, 1);

  // ── Sub-score D: streak bonus ──
  var streakWeeks = 0;
  var cursor = new Date(now);
  while (streakWeeks < 8) {
    var wk = _isoWeekKey(cursor);
    if (!weekSet[wk]) break;
    streakWeeks++;
    cursor.setDate(cursor.getDate() - 7);
  }
  var sD = streakWeeks / 8;

  var raw = 0.35 * sA + 0.30 * sB + 0.20 * sC + 0.15 * sD;
  var score = Math.round(_clamp(raw * 100, 0, 100));

  var bands = [
    { max: 34, label: 'Low' },
    { max: 59, label: 'Medium' },
    { max: 79, label: 'High' },
    { max: 100, label: 'Excellent' }
  ];

  return {
    score: score,
    band: _bandLabel(score, bands),
    breakdown: {
      activeWeeks: { raw: activeWeeks, outOf: WEEKS_IN_WINDOW, subScore: sA },
      gapRegularity: { submissionsAnalysed: dates.length, subScore: sB },
      plannerUsage: { weeksWithPlan: weeksWithPlan, advanceRatio: advanceRatio, subScore: sC },
      streakBonus: { currentStreakWeeks: streakWeeks, subScore: sD }
    },
    reason: null
  };
}

// ── Score 2: Responsibility ─────────────────────────────────────────────────

/**
 * @param {Array}   completions
 * @param {Array}   spending
 * @param {Array}   payouts
 * @param {Array}   subscriptions
 * @param {Array}   suggestions
 * @param {Object}  config        { goals:[], model:{}, goal:{} }
 * @param {Date}    now
 */
function calculateResponsibilityScore(completions, spending, payouts, subscriptions, suggestions, cfg, now) {
  var WINDOW = 90;

  if (_isGracePeriod(completions, [], spending, now)) {
    return { score: null, band: null, breakdown: {}, reason: 'insufficient_data' };
  }

  var compWindow = _withinWindow(completions, 'submittedAt', now, WINDOW);
  var spendWindow = _withinWindow(spending, 'spentAt', now, WINDOW);
  var payoutWindow = _withinWindow(payouts, 'paidAt', now, WINDOW);
  var suggWindow = _withinWindow(suggestions, 'submittedAt', now, WINDOW);

  // ── Sub-score A: approval quality ──
  var reviewed = compWindow.filter(function(c) { return c.status === 'approved' || c.status === 'rejected'; });
  var approvalRate = reviewed.length > 0
    ? reviewed.filter(function(c) { return c.status === 'approved'; }).length / reviewed.length
    : 0.5;
  var rated = compWindow.filter(function(c) { return c.rating === 1 || c.rating === -1; });
  var positiveRate = rated.length > 0
    ? rated.filter(function(c) { return c.rating === 1; }).length / rated.length
    : 0.7;
  var sA = reviewed.length === 0 ? 0.5 : (0.6 * approvalRate + 0.4 * positiveRate);

  // ── Sub-score B: spending discipline ──
  var totalEarned = compWindow
    .filter(function(c) { return c.status === 'approved'; })
    .reduce(function(s, c) { return s + (c.price || 0); }, 0)
    + payoutWindow.reduce(function(s, p) { return s + (p.amount || 0); }, 0);
  var totalSpent = spendWindow.reduce(function(s, d) { return s + (d.amount || 0); }, 0);
  var sB;
  if (totalEarned === 0 && totalSpent === 0) {
    sB = 0.75;
  } else if (totalEarned === 0) {
    sB = 0;
  } else {
    var spendRatio = totalSpent / totalEarned;
    if (spendRatio <= 0.80) {
      sB = 1.0;
    } else if (spendRatio <= 1.0) {
      sB = 1.0 - ((spendRatio - 0.80) / 0.20) * 0.4;
    } else {
      sB = Math.max(0, 0.60 - (spendRatio - 1.0) * 0.6);
    }
  }

  // ── Sub-score C: goal commitment ──
  var goals = (cfg && cfg.goals) || [];
  var sC;
  if (!goals.length) {
    sC = 0;
  } else {
    var deadlineRatio = goals.filter(function(g) { return g.deadline && new Date(g.deadline) > now; }).length / goals.length;
    var allocRatio = goals.filter(function(g) { return (g.allocPct || 0) > 0; }).length / goals.length;
    var progressRatio = goals.filter(function(g) { return (g.earnedTowardGoal || 0) > 0; }).length / goals.length;
    sC = 0.35 * deadlineRatio + 0.40 * allocRatio + 0.25 * progressRatio;
  }

  // ── Sub-score D: savings allocation ──
  var totalAllocPct = goals.reduce(function(s, g) { return s + (g.allocPct || 0); }, 0);
  var cappedAllocPct = Math.min(totalAllocPct, 100);
  var sD = goals.length ? Math.min(1.0, Math.sqrt(cappedAllocPct / 60)) : 0;

  // ── Sub-score E: subscription awareness ──
  var activeSubs = subscriptions.filter(function(s) { return s.active !== false; });
  var sE;
  if (!activeSubs.length) {
    sE = 0.4;
  } else {
    var monthlyCommitted = activeSubs.reduce(function(sum, sub) {
      var amt = sub.amount || 0;
      if (sub.frequency === 'weekly') return sum + amt * 52 / 12;
      if (sub.frequency === 'monthly') return sum + amt;
      if (sub.frequency === 'quarterly') return sum + amt / 3;
      if (sub.frequency === 'annual') return sum + amt / 12;
      return sum + amt;
    }, 0);
    var monthlyEarned = totalEarned / 3;
    var commitmentRatio = monthlyEarned > 0 ? monthlyCommitted / monthlyEarned : 2;
    if (commitmentRatio <= 0.30) {
      sE = 1.0;
    } else if (commitmentRatio <= 0.60) {
      sE = 1.0 - ((commitmentRatio - 0.30) / 0.30) * 0.5;
    } else {
      sE = Math.max(0, 0.5 - (commitmentRatio - 0.60));
    }
  }

  // ── Sub-score F: initiative ──
  var approved = suggWindow.filter(function(s) { return s.status === 'approved'; }).length;
  var rawInit = Math.min(suggWindow.length, 4) / 4;
  var sF = Math.min(1.0, rawInit + Math.min(approved, 2) * 0.1);

  var raw = 0.25 * sA + 0.20 * sB + 0.20 * sC + 0.15 * sD + 0.10 * sE + 0.10 * sF;
  var score = Math.round(_clamp(raw * 100, 0, 100));

  var bands = [
    { max: 34, label: 'Low' },
    { max: 59, label: 'Medium' },
    { max: 79, label: 'High' },
    { max: 100, label: 'Excellent' }
  ];

  return {
    score: score,
    band: _bandLabel(score, bands),
    breakdown: {
      approvalQuality: { approvalRate: approvalRate, positiveRate: positiveRate, subScore: sA },
      spendingDiscipline: { totalEarned: totalEarned, totalSpent: totalSpent, subScore: sB },
      goalCommitment: { activeGoals: goals.length, subScore: sC },
      savingsAllocation: { totalAllocPct: totalAllocPct, subScore: sD },
      subscriptionAwareness: { activeCount: activeSubs.length, subScore: sE },
      initiative: { submitted: suggWindow.length, approved: approved, subScore: sF }
    },
    reason: null
  };
}

// ── Score 3: Planning Horizon ───────────────────────────────────────────────

/**
 * @param {Array}   completions
 * @param {Array}   plans
 * @param {Array}   subscriptions
 * @param {Object}  config
 * @param {Date}    now
 * @returns {{ horizonWeeks, band, breakdown, reason }}
 */
function calculatePlanningHorizon(completions, plans, subscriptions, cfg, now) {
  if (_isGracePeriod(completions, plans, [], now)) {
    return { horizonWeeks: null, band: null, breakdown: {}, reason: 'insufficient_data' };
  }

  var goals = (cfg && cfg.goals) || [];

  // ── Signal A: goal horizon ──
  var goalsWithDeadlineAndAlloc = goals.filter(function(g) {
    return g.deadline && new Date(g.deadline) > now && (g.allocPct || 0) > 0;
  });
  var hA;
  if (!goalsWithDeadlineAndAlloc.length) {
    hA = 0;
  } else {
    var totalAlloc = goalsWithDeadlineAndAlloc.reduce(function(s, g) { return s + (g.allocPct || 0); }, 0);
    var weightedSum = goalsWithDeadlineAndAlloc.reduce(function(s, g) {
      var weeksAway = (new Date(g.deadline) - now) / (7 * 864e5);
      return s + Math.min(weeksAway, 104) * (g.allocPct || 0);
    }, 0);
    hA = Math.min(weightedSum / totalAlloc, 52);
  }

  // ── Signal B: planner lead time ──
  var cutoff60 = new Date(now.getTime() - 60 * 864e5);
  var advancePlans = plans.filter(function(p) {
    var ca = _toDate(p.createdAt);
    var ws = p.weekStart ? (typeof p.weekStart === 'string' ? new Date(p.weekStart) : _toDate(p.weekStart)) : null;
    return ca && ws && ca >= cutoff60 && ws > ca;
  });
  var hB = 0;
  if (advancePlans.length > 0) {
    var totalLeadDays = advancePlans.reduce(function(s, p) {
      var ca = _toDate(p.createdAt);
      var ws = p.weekStart ? (typeof p.weekStart === 'string' ? new Date(p.weekStart) : _toDate(p.weekStart)) : null;
      return s + Math.min((ws - ca) / 864e5, 14);
    }, 0);
    hB = (totalLeadDays / advancePlans.length) / 7;
  }

  // ── Signal C: goal funding trajectory ──
  var compLast60 = _withinWindow(completions, 'submittedAt', now, 60)
    .filter(function(c) { return c.status === 'approved'; });
  var weeklyEarningRate = compLast60.reduce(function(s, c) { return s + (c.price || 0); }, 0) / 8.57;
  var fundingGoals = goals.filter(function(g) {
    return (g.amount || 0) > (g.earnedTowardGoal || 0) && (g.allocPct || 0) > 0;
  });
  var hC = 0;
  if (fundingGoals.length && weeklyEarningRate > 0) {
    var weeksToFundArr = fundingGoals.map(function(g) {
      var remaining = (g.amount || 0) - (g.earnedTowardGoal || 0);
      var weeklyAlloc = weeklyEarningRate * (g.allocPct / 100);
      return Math.min(remaining / Math.max(weeklyAlloc, 0.01), 52);
    });
    hC = Math.min(_median(weeksToFundArr), 26);
  }

  // ── Signal D: subscription commitment ──
  var activeSubs = subscriptions.filter(function(s) { return s.active !== false; });
  var hD = 0;
  if (activeSubs.length) {
    var subWeeks = activeSubs.map(function(s) {
      if (s.frequency === 'weekly') return 4;
      if (s.frequency === 'monthly') return 8;
      if (s.frequency === 'quarterly') return 13;
      if (s.frequency === 'annual') return 26;
      return 8;
    });
    hD = Math.min(subWeeks.reduce(function(a, b) { return a + b; }, 0) / subWeeks.length, 13);
  }

  var raw = 0.45 * hA + 0.25 * hB + 0.20 * hC + 0.10 * hD;
  var horizonWeeks = Math.round(raw * 10) / 10;

  var bands = [
    { max: 1.9,  label: 'Low' },
    { max: 5.9,  label: 'Medium' },
    { max: 9.9,  label: 'High' },
    { max: 9999, label: 'Excellent' }
  ];

  return {
    horizonWeeks: horizonWeeks,
    band: _bandLabel(horizonWeeks, bands),
    breakdown: {
      goalHorizon: { goalsWithDeadlineAndAlloc: goalsWithDeadlineAndAlloc.length, H: hA },
      plannerLeadTime: { advancePlansAnalysed: advancePlans.length, H: hB },
      goalFundingTrajectory: { weeklyEarningRate: weeklyEarningRate, H: hC },
      subscriptionCommitment: { activeCount: activeSubs.length, H: hD }
    },
    reason: null
  };
}

// ── Notification matching ───────────────────────────────────────────────────

/**
 * Given the three computed scores, return a prioritised list of
 * matching notification objects from PARENT_NOTIFICATIONS.
 *
 * @param {Object} consistency   result of calculateConsistencyScore
 * @param {Object} responsibility result of calculateResponsibilityScore
 * @param {Object} planning      result of calculatePlanningHorizon
 * @param {Object} cfg           app config
 * @param {Array}  completions   (for recent rejects / inactivity check)
 * @param {Date}   now
 * @returns {Array} sorted notification objects (most important first)
 */
function matchParentNotifications(consistency, responsibility, planning, cfg, completions, now) {
  if (typeof PARENT_NOTIFICATIONS === 'undefined' || !PARENT_NOTIFICATIONS) return [];

  var cs = consistency.score;
  var rs = responsibility.score;
  var ph = planning.horizonWeeks;
  var goals = (cfg && cfg.goals) || [];

  // Days since last completion
  var recent = completions
    .filter(function(c) { return c.status !== 'rejected'; })
    .map(function(c) { return _toDate(c.submittedAt); })
    .filter(Boolean);
  var daysSinceLast = recent.length
    ? Math.floor((now - new Date(Math.max.apply(null, recent))) / 864e5)
    : 999;

  // Rejection spike: 3+ rejections in last 14 days
  var recentRejects = _withinWindow(completions, 'submittedAt', now, 14)
    .filter(function(c) { return c.status === 'rejected'; }).length;

  // Quality decline: 3+ thumbs down in last 14 days
  var recentDownRatings = _withinWindow(completions, 'submittedAt', now, 14)
    .filter(function(c) { return c.rating === -1; }).length;

  // Spending vs earnings this month
  // (simplified: available from breakdown)
  var spendRatio = responsibility.breakdown && responsibility.breakdown.spendingDiscipline
    ? (responsibility.breakdown.spendingDiscipline.totalSpent /
       Math.max(responsibility.breakdown.spendingDiscipline.totalEarned, 1))
    : 0;

  // Goals: any goal completable that's near
  var nearGoal = goals.find(function(g) {
    return g.earnedTowardGoal && g.amount &&
           (g.earnedTowardGoal / g.amount) >= 0.80;
  });

  // Evaluate triggers
  var triggers = [];

  if (daysSinceLast >= 10) triggers.push('long_inactivity');
  if (cs !== null && cs < 30) triggers.push('consistency_low');
  if (cs !== null && cs >= 85 && consistency.breakdown && consistency.breakdown.streakBonus &&
      consistency.breakdown.streakBonus.currentStreakWeeks >= 4) triggers.push('consistency_excellent');
  if (cs !== null && cs >= 35 && cs <= 85) {
    // Could be improving — no historical comparison here, include medium message
    if (consistency.breakdown.activeWeeks && consistency.breakdown.activeWeeks.raw >= 10)
      triggers.push('consistency_improving');
  }
  if (consistency.breakdown && consistency.breakdown.streakBonus &&
      consistency.breakdown.streakBonus.currentStreakWeeks >= 7) triggers.push('consistency_streak');

  if (recentRejects >= 3) triggers.push('responsibility_rejection_spike');
  if (recentDownRatings >= 3) triggers.push('responsibility_quality_decline');
  if (rs !== null && rs >= 80) triggers.push('responsibility_high');
  if (goals.filter(function(g) { return g.deadline && new Date(g.deadline) > now; }).length >= 2)
    triggers.push('responsibility_goal_setter');
  if (spendRatio >= 0.80) triggers.push('responsibility_spender');
  if (spendRatio <= 0.60 && rs !== null && rs >= 60) triggers.push('responsibility_saver');

  if (ph !== null && ph >= 8) triggers.push('planning_long');
  else if (ph !== null && ph >= 4) triggers.push('planning_medium');
  else if (ph !== null && ph < 2) triggers.push('planning_short');
  if (!goals.length) triggers.push('planning_no_goals');
  if (ph !== null && ph >= 6 && planning.breakdown.goalFundingTrajectory &&
      planning.breakdown.goalFundingTrajectory.H > 0) triggers.push('planning_deadline_achiever');

  if (nearGoal) triggers.push('first_goal_complete');
  if (cs !== null && rs !== null && cs >= 80 && rs >= 75 && ph !== null && ph >= 6)
    triggers.push('ready_for_banking');
  else if (cs !== null && rs !== null && cs >= 75 && rs >= 75)
    triggers.push('consistent_and_responsible');

  // Match notifications to triggered conditions
  var matched = [];
  var seen = {};
  triggers.forEach(function(trigger) {
    PARENT_NOTIFICATIONS.forEach(function(n) {
      if (n.trigger === trigger && !seen[n.id]) {
        seen[n.id] = true;
        matched.push(n);
      }
    });
  });

  // Sort: action > warning > positive > info
  var priorityOrder = { action: 0, warning: 1, positive: 2, info: 3 };
  matched.sort(function(a, b) {
    return (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3);
  });

  return matched;
}

/**
 * Replace {name} and {parent} tokens in a message string.
 */
function formatInsightMessage(text, childName, parentName) {
  return text
    .replace(/\{name\}/g, childName || 'your child')
    .replace(/\{parent\}/g, parentName || 'you');
}
