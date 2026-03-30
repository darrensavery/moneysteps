// patch_report.js — Financial progress report for parents
const fs = require('fs');
const path = require('path').join(__dirname, 'index.html');
let c = fs.readFileSync(path, 'utf8');

function replace(old, neo, label) {
  if (!c.includes(old)) { console.error('MISS:', label); process.exit(1); }
  c = c.replace(old, neo);
  console.log('OK:', label);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. CSS
// ─────────────────────────────────────────────────────────────────────────────
replace(
`.cost-hint{font-size:11px;color:var(--muted);margin-top:3px}`,
`.cost-hint{font-size:11px;color:var(--muted);margin-top:3px}
/* ── Financial report ── */
.report-scores{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px}
.score-card{border-radius:14px;padding:14px 16px;text-align:center}
.score-card.green{background:#D1FAE5;border:1px solid #6EE7B7}
.score-card.amber{background:#FEF3C7;border:1px solid #FCD34D}
.score-card.red{background:#FEE2E2;border:1px solid #FCA5A5}
.score-card.grey{background:var(--gray-l);border:1px solid var(--border)}
.score-num{font-size:36px;font-weight:900;line-height:1;margin-bottom:2px}
.score-card.green .score-num{color:#065F46}
.score-card.amber .score-num{color:#92400E}
.score-card.red .score-num{color:#991B1B}
.score-card.grey .score-num{color:var(--muted)}
.score-label{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;opacity:.7}
.score-desc{font-size:12px;font-weight:700;margin-top:4px}
.score-card.green .score-desc{color:#065F46}
.score-card.amber .score-desc{color:#92400E}
.score-card.red .score-desc{color:#991B1B}
.horizon-card{background:var(--white);border:1px solid var(--border);border-radius:14px;padding:14px 16px;margin-bottom:14px;display:flex;align-items:center;gap:14px}
.horizon-icon{font-size:28px;line-height:1;flex-shrink:0}
.horizon-label{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:3px}
.horizon-value{font-size:16px;font-weight:800;color:var(--text)}
.horizon-sub{font-size:11px;color:var(--muted);margin-top:2px}
.readiness-bar-wrap{margin-bottom:14px}
.readiness-bar-track{background:var(--gray-l);border-radius:99px;height:12px;overflow:hidden;margin:6px 0 4px}
.readiness-bar-fill{border-radius:99px;height:12px;transition:width .5s;background:linear-gradient(90deg,#0F6E56,#1a9470)}
.readiness-labels{display:flex;justify-content:space-between;font-size:10px;color:var(--muted);font-weight:700}
.readiness-level{font-size:13px;font-weight:800;color:var(--text);margin-top:2px}
.feedback-section-title{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin:16px 0 8px}
.feedback-card{border-radius:12px;padding:12px 14px;margin-bottom:8px;border-left:4px solid transparent}
.feedback-card.positive{background:#F0FDF4;border-left-color:#22C55E}
.feedback-card.warning{background:#FFFBEB;border-left-color:#F59E0B}
.feedback-card.neutral{background:var(--gray-l);border-left-color:var(--border)}
.fb-title{font-size:13px;font-weight:800;color:var(--text);margin-bottom:3px}
.fb-msg{font-size:12px;color:var(--text);line-height:1.4;margin-bottom:4px}
.fb-advice{font-size:11px;color:var(--muted);font-style:italic}
.report-empty{text-align:center;padding:20px 0;color:var(--muted);font-size:13px}`,
'CSS report'
);

// ─────────────────────────────────────────────────────────────────────────────
// 2. HTML — add Progress Report card to boss-settings-parental
// ─────────────────────────────────────────────────────────────────────────────
replace(
`      <div class="settings-card">
        <h3>Reset Logan's PIN</h3>`,
`      <div class="settings-card">
        <h3>Financial Progress Report</h3>
        <p style="font-size:13px;color:var(--muted);margin-bottom:12px">Scores based on consistency, responsibility and planning habits. Updated every time you open this.</p>
        <div id="report-preview" style="display:flex;gap:10px;margin-bottom:12px">
          <div id="rp-consistency" style="flex:1;background:var(--gray-l);border-radius:10px;padding:10px;text-align:center">
            <div style="font-size:22px;font-weight:900;color:var(--muted)">—</div>
            <div style="font-size:10px;font-weight:800;text-transform:uppercase;color:var(--muted);letter-spacing:.5px">Consistency</div>
          </div>
          <div id="rp-responsibility" style="flex:1;background:var(--gray-l);border-radius:10px;padding:10px;text-align:center">
            <div style="font-size:22px;font-weight:900;color:var(--muted)">—</div>
            <div style="font-size:10px;font-weight:800;text-transform:uppercase;color:var(--muted);letter-spacing:.5px">Responsibility</div>
          </div>
          <div id="rp-horizon" style="flex:1;background:var(--gray-l);border-radius:10px;padding:10px;text-align:center">
            <div style="font-size:22px">—</div>
            <div style="font-size:10px;font-weight:800;text-transform:uppercase;color:var(--muted);letter-spacing:.5px">Horizon</div>
          </div>
        </div>
        <button class="btn-primary" onclick="openProgressReport()" style="max-width:200px;padding:10px 16px;font-size:14px">View full report</button>
      </div>
      <div class="settings-card">
        <h3>Reset Logan's PIN</h3>`,
'HTML report preview card'
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. HTML — add progress report modal (before closing </body>-adjacent area)
// ─────────────────────────────────────────────────────────────────────────────
replace(
`<!-- GOAL EDITOR MODAL -->`,
`<!-- PROGRESS REPORT MODAL -->
<div class="modal-overlay" id="modal-progress-report">
  <div class="modal" style="max-height:90vh;overflow-y:auto">
    <button class="modal-close" onclick="closeModal('modal-progress-report')"><i data-lucide="x" width="16" height="16" class="lucide"></i></button>
    <div class="modal-title" id="report-modal-title">Financial Report</div>
    <div id="report-modal-content"><!-- rendered by renderProgressReport() --></div>
  </div>
</div>

<!-- GOAL EDITOR MODAL -->`,
'HTML progress report modal'
);

// ─────────────────────────────────────────────────────────────────────────────
// 4. JS — add report functions before the // ── Settings block
// ─────────────────────────────────────────────────────────────────────────────
replace(
`function showBossSettingsGroup(group){`,
`// ── Financial Progress Report ──────────────────────────────────────────────
function weekStartOffset(weeksAgo){
  var d=new Date();d.setHours(0,0,0,0);
  var dow=d.getDay();
  d.setDate(d.getDate()+(dow===0?-6:1-dow)-weeksAgo*7);
  return d.toISOString().slice(0,10);
}
function tsMs(ts){
  if(!ts) return 0;
  if(ts.toDate) return ts.toDate().getTime();
  return new Date(ts).getTime();
}
function calcFinancialReport(){
  var now=Date.now();
  var loganName=config.logan&&config.logan.name||'Logan';
  // Last 8 week starts
  var weeks8=[];for(var i=0;i<8;i++) weeks8.push(weekStartOffset(i));
  // Future week starts (for planning horizon)
  var future=[];for(var j=1;j<=8;j++) future.push(weekStartOffset(-j));
  // Completions
  var allApproved=completions.filter(function(c){return c.status==='approved';});
  var allRejected=completions.filter(function(c){return c.status==='rejected';});
  var totalSubs=allApproved.length+allRejected.length;
  var approvalRate=totalSubs>=5?allApproved.length/totalSubs:null;
  // Weeks with at least 1 approved chore (last 8 weeks)
  var weeksWithCompletions=weeks8.filter(function(ws){
    var wsMs=new Date(ws+'T00:00:00').getTime();
    return allApproved.some(function(c){
      var ms=tsMs(c.submittedAt);
      return ms>=wsMs&&ms<wsMs+7*86400000;
    });
  }).length;
  // Weeks with at least 1 plan (last 8 weeks)
  var weeksWithPlans=weeks8.filter(function(ws){
    return plans.some(function(p){return p.weekStart===ws;});
  }).length;
  // Future weeks with plans (planning horizon)
  var futurePlannedWeeks=0;
  future.forEach(function(ws){
    if(plans.some(function(p){return p.weekStart===ws;})) futurePlannedWeeks++;
  });
  // How many consecutive future weeks (from next week onwards)
  var consecutiveFutureWeeks=0;
  for(var k=0;k<future.length;k++){
    if(plans.some(function(p){return p.weekStart===future[k];})) consecutiveFutureWeeks=k+1;
    else break;
  }
  // Earnings & spending
  var modelType=getModel().type;
  var isAllowanceOnly=modelType==='allowance';
  var earnedChores=isAllowanceOnly?0:allApproved.reduce(function(s,c){return s+c.price;},0);
  var totalEarned=earnedChores+calcAllowanceAccrued();
  var totalSpent=spending.reduce(function(s,p){return s+p.amount;},0);
  var spendingRate=totalEarned>1?totalSpent/totalEarned:null;
  // Spending in last 4 weeks
  var w4ago=now-28*86400000;
  var recentSpendCount=spending.filter(function(p){return tsMs(p.spentAt)>=w4ago;}).length;
  // Goals
  var goals=config.logan.goals||[];
  var goalCount=goals.length;
  var goalsWithDeadlines=goals.filter(function(g){return g.deadline;}).length;
  var goalsWithAlloc=goals.filter(function(g){return g.allocPct>0;}).length;
  var available=Math.max(0,totalEarned-payouts.reduce(function(s,p){return s+p.amount;},0)-totalSpent-calcTotalSubAccrued());
  var goalsHalfFunded=goals.filter(function(g){return g.allocPct&&available*g.allocPct/100>=g.amount*0.5;}).length;
  var goalsFullyFunded=goals.filter(function(g){return g.allocPct&&available*g.allocPct/100>=g.amount;}).length;
  var maxDeadlineDays=goals.length?Math.max.apply(null,goals.filter(function(g){return g.deadline;}).map(function(g){
    return Math.ceil((new Date(g.deadline)-new Date())/86400000);
  }).concat([0])):0;
  // Streak
  var streak=calcStreak();
  var bestStreak=calcBestStreak();
  // Subs
  var activeSubCount=(subscriptions||[]).filter(function(s){return s.active;}).length;
  // Match rate
  var matchRate=config.logan&&config.logan.goal&&config.logan.goal.matchRate||0;
  // Weeks active (how long they've been using the app)
  var oldestCompletion=allApproved.length?Math.min.apply(null,allApproved.map(function(c){return tsMs(c.submittedAt);})):now;
  var weeksActive=Math.floor((now-oldestCompletion)/(7*86400000));

  // ── CONSISTENCY SCORE (0-100) ──
  var cs=0;
  if(weeksWithCompletions||totalEarned>0){
    // Chore/earning consistency over 8 weeks (max 50)
    cs+=Math.round((weeksWithCompletions/8)*50);
    // Planner usage over 8 weeks (max 30)
    cs+=Math.round((weeksWithPlans/8)*30);
    // Saving setup (max 20)
    if(goalsWithAlloc>0) cs+=20; else if(goalCount>0) cs+=10;
  }
  cs=Math.min(100,cs);

  // ── RESPONSIBILITY SCORE (0-100) ──
  var rs=0;
  if(totalSubs>=3||totalEarned>5){
    // Submission quality (max 35)
    if(approvalRate!==null) rs+=Math.round(approvalRate*35); else rs+=18;
    // Spending discipline (max 40)
    if(spendingRate!==null){
      if(spendingRate<=0.3) rs+=40;
      else if(spendingRate<=0.5) rs+=32;
      else if(spendingRate<=0.7) rs+=22;
      else if(spendingRate<=0.9) rs+=10;
      else rs+=3;
    } else rs+=20;
    // Goal adherence (max 25)
    if(goalCount>0) rs+=8;
    if(goalsWithAlloc>0) rs+=9;
    if(goalsWithDeadlines>0) rs+=8;
  }
  rs=Math.min(100,rs);

  // ── PLANNING HORIZON ──
  var horizonLevel=0;
  if(consecutiveFutureWeeks>=4||maxDeadlineDays>=180) horizonLevel=4;
  else if(consecutiveFutureWeeks>=2||maxDeadlineDays>=90) horizonLevel=3;
  else if(consecutiveFutureWeeks>=1||maxDeadlineDays>=30||weeksWithPlans>=4) horizonLevel=2;
  else if(weeksWithPlans>=2||goalCount>0) horizonLevel=1;

  var horizonLabels=['Day-to-day','Week-to-week','Short-term','Medium-term','Long-term'];
  var horizonIcons=['📌','📅','🗓️','🎯','🚀'];
  var horizonSubs=['No forward planning yet','Planning 1–2 weeks ahead','Planning 1–4 weeks ahead','Planning 1–3 months ahead','Planning 3+ months ahead'];

  // ── BANKING READINESS ──
  var avgScore=Math.round((cs+rs)/2);
  var readinessLevel,readinessLabel,readinessPct;
  if(totalSubs<4&&totalEarned<5){
    readinessLevel=0;readinessLabel='Not enough data yet';readinessPct=0;
  } else if(avgScore<40){
    readinessLevel=1;readinessLabel='Building foundations';readinessPct=Math.round(avgScore/40*20);
  } else if(avgScore<55){
    readinessLevel=2;readinessLabel='Developing good habits';readinessPct=Math.round(20+(avgScore-40)/15*20);
  } else if(avgScore<68){
    readinessLevel=3;readinessLabel='Showing real responsibility';readinessPct=Math.round(40+(avgScore-55)/13*20);
  } else if(avgScore<80){
    readinessLevel=4;readinessLabel='Ready for guided financial tools';readinessPct=Math.round(60+(avgScore-68)/12*20);
  } else if(avgScore<92){
    readinessLevel=5;readinessLabel='Ready for a youth bank account';readinessPct=Math.round(80+(avgScore-80)/12*15);
  } else {
    readinessLevel=6;readinessLabel='Exceptional financial maturity';readinessPct=100;
  }

  return {
    name:loganName,
    // raw
    weeksWithCompletions,weeksWithPlans,consecutiveFutureWeeks,futurePlannedWeeks,
    totalApproved:allApproved.length,totalRejected:allRejected.length,totalSubs,
    approvalRate,spendingRate,totalEarned,totalSpent,recentSpendCount,
    goalCount,goalsWithDeadlines,goalsWithAlloc,goalsHalfFunded,goalsFullyFunded,
    maxDeadlineDays,streak,bestStreak,activeSubCount,matchRate,weeksActive,
    // scores
    consistencyScore:cs,responsibilityScore:rs,
    horizonLevel,horizonLabel:horizonLabels[horizonLevel],horizonIcon:horizonIcons[horizonLevel],horizonSub:horizonSubs[horizonLevel],
    // readiness
    readinessLevel,readinessLabel,readinessPct
  };
}

var FEEDBACK_LIBRARY=[
  // ── CONSISTENCY ───────────────────────────────────────────────────────────
  {id:'streak_7',cat:'Consistency',sentiment:'positive',priority:2,
   check:function(d){return d.streak>=7;},
   title:'7-day chore streak',
   msg:function(n){return n+' has completed chores 7 days in a row. This kind of momentum is where habits form.';},
   advice:'Acknowledge it — verbal recognition at this stage reinforces the behaviour.'},
  {id:'streak_21',cat:'Consistency',sentiment:'positive',priority:1,
   check:function(d){return d.streak>=21;},
   title:'3-week streak — exceptional',
   msg:function(n){return n+' has maintained a 21-day chore streak. This level of consistency is rare and genuinely impressive.';},
   advice:'Consider a small recognition — a treat or an increase in their allowance for the month.'},
  {id:'planner_4wks',cat:'Consistency',sentiment:'positive',priority:2,
   check:function(d){return d.weeksWithPlans>=4&&d.weeksWithPlans<7;},
   title:'Regular planner use',
   msg:function(n){return n+' has used the weekly planner for '+d.weeksWithPlans+' of the last 8 weeks — a solid planning habit forming.';},
   advice:'Encourage them to look 2 weeks ahead rather than just the current week.'},
  {id:'planner_8wks',cat:'Consistency',sentiment:'positive',priority:1,
   check:function(d){return d.weeksWithPlans>=7;},
   title:'Planning every week',
   msg:function(n,d){return n+' has planned their chores consistently for the past two months without being prompted. That is a strong signal of self-direction.';},
   advice:'You might consider loosening day-to-day controls and letting them manage their own schedule.'},
  {id:'saving_auto',cat:'Consistency',sentiment:'positive',priority:2,
   check:function(d){return d.goalsWithAlloc>=1;},
   title:'Automatic saving in place',
   msg:function(n){return n+' has set up automatic allocation toward a savings goal — money has a purpose before it gets spent.';},
   advice:'This is the core habit behind long-term financial health. Worth celebrating.'},
  {id:'no_planner',cat:'Consistency',sentiment:'warning',priority:2,
   check:function(d){return d.weeksWithPlans===0&&d.totalApproved>=4;},
   title:'Weekly planner unused',
   msg:function(n){return n+' has earned money but has never used the weekly planner. All decisions are reactive rather than planned.';},
   advice:'Sit down together and add next week\'s chores. The first plan is the hardest — after that it becomes routine.'},
  {id:'inconsistent',cat:'Consistency',sentiment:'warning',priority:2,
   check:function(d){return d.weeksWithCompletions<3&&d.totalApproved>=6;},
   title:'Inconsistent activity',
   msg:function(n){return n+' is active some weeks and completely absent others. Inconsistency is one of the main barriers to building financial habits.';},
   advice:'Try linking screen time or something they value to at least one completed chore per week.'},
  {id:'no_goals',cat:'Consistency',sentiment:'warning',priority:3,
   check:function(d){return d.goalCount===0&&d.totalEarned>=15;},
   title:'No savings goals set',
   msg:function(n){return n+' has earned money but has no savings goals. Without a purpose for money, spending becomes the default.';},
   advice:'Ask them: "Is there anything you\'ve been wanting for a while?" Start there.'},
  // ── RESPONSIBILITY ─────────────────────────────────────────────────────────
  {id:'approval_high',cat:'Responsibility',sentiment:'positive',priority:2,
   check:function(d){return d.approvalRate!==null&&d.approvalRate>=0.85&&d.totalSubs>=6;},
   title:'High first-time approval rate',
   msg:function(n,d){return Math.round(d.approvalRate*100)+'% of '+n+'\'s chore submissions are approved first time — they take care to do things properly.';},
   advice:'This is a strong indicator of work ethic. Consider trusting their self-assessments more.'},
  {id:'spending_restrained',cat:'Responsibility',sentiment:'positive',priority:2,
   check:function(d){return d.spendingRate!==null&&d.spendingRate<=0.5&&d.totalEarned>=15;},
   title:'Restrained spending',
   msg:function(n,d){return n+' has only spent '+Math.round(d.spendingRate*100)+'% of their total earnings — naturally saving the rest without being told to.';},
   advice:'Reinforce this with praise. It\'s genuinely unusual and worth naming.'},
  {id:'spending_very_low',cat:'Responsibility',sentiment:'positive',priority:1,
   check:function(d){return d.spendingRate!==null&&d.spendingRate<=0.25&&d.totalEarned>=20;},
   title:'Exceptional spending discipline',
   msg:function(n,d){return n+' has spent only '+Math.round(d.spendingRate*100)+'% of their earnings. They are building real financial reserves.';},
   advice:'Check that their savings goals are ambitious enough — they may be ready for a bigger challenge.'},
  {id:'goal_halfway',cat:'Responsibility',sentiment:'positive',priority:2,
   check:function(d){return d.goalsHalfFunded>=1;},
   title:'Goal 50% funded',
   msg:function(n){return n+'\'s saving is paying off — at least one goal is already halfway funded.';},
   advice:'Draw attention to this milestone. Progress visibility is a powerful motivator.'},
  {id:'goal_reached',cat:'Responsibility',sentiment:'positive',priority:1,
   check:function(d){return d.goalsFullyFunded>=1;},
   title:'Goal fully funded',
   msg:function(n){return n+' has fully funded a savings goal. This is a significant milestone — they set a target and reached it.';},
   advice:'Mark this moment. Let them make the purchase or decision themselves — the autonomy matters.'},
  {id:'low_impulse',cat:'Responsibility',sentiment:'positive',priority:3,
   check:function(d){return d.recentSpendCount<=1&&d.totalEarned>10;},
   title:'Very few recent purchases',
   msg:function(n){return n+' has made at most one purchase in the last four weeks — a sign of considered, deliberate spending rather than impulse buying.';},
   advice:'This kind of restraint is worth naming directly — most teenagers spend reactively.'},
  {id:'multiple_goals',cat:'Responsibility',sentiment:'positive',priority:2,
   check:function(d){return d.goalCount>=3;},
   title:'Managing multiple goals',
   msg:function(n,d){return n+' is managing '+d.goalCount+' savings goals simultaneously — balancing competing priorities is an advanced financial skill.';},
   advice:'Ask them how they decided on the allocation between goals. The reasoning matters as much as the outcome.'},
  {id:'approval_low',cat:'Responsibility',sentiment:'warning',priority:2,
   check:function(d){return d.approvalRate!==null&&d.approvalRate<0.5&&d.totalSubs>=5;},
   title:'High rejection rate',
   msg:function(n,d){return 'More than half of '+n+'\'s chore submissions have been rejected. This may suggest unclear expectations or lack of effort.';},
   advice:'Review the standards together — are the expectations clearly communicated, or are they guessing?'},
  {id:'spending_high',cat:'Responsibility',sentiment:'warning',priority:2,
   check:function(d){return d.spendingRate!==null&&d.spendingRate>0.85&&d.totalEarned>=15;},
   title:'Spending most of what is earned',
   msg:function(n,d){return n+' is spending '+Math.round(d.spendingRate*100)+'% of their earnings — leaving very little for goals or unexpected needs.';},
   advice:'A conversation about the difference between what you can spend and what you should spend could be valuable here.'},
  {id:'spending_everything',cat:'Responsibility',sentiment:'warning',priority:1,
   check:function(d){return d.spendingRate!==null&&d.spendingRate>=0.95&&d.totalEarned>=20;},
   title:'Spending everything earned',
   msg:function(n){return n+' is spending almost their entire balance. There is no buffer for goals or unexpected needs.';},
   advice:'Consider requiring that a fixed percentage is saved before any spending is logged. Even 10% builds the habit.'},
  {id:'goals_no_alloc',cat:'Responsibility',sentiment:'neutral',priority:3,
   check:function(d){return d.goalCount>=1&&d.goalsWithAlloc===0;},
   title:'Goals set, no auto-save',
   msg:function(n){return n+' has savings goals but has not set any automatic allocation. The goals exist in name only.';},
   advice:'Help them set even a small auto-save percentage. Money earmarked before spending decisions are made is far more likely to reach its destination.'},
  // ── PLANNING ───────────────────────────────────────────────────────────────
  {id:'plan_2wks',cat:'Planning',sentiment:'positive',priority:2,
   check:function(d){return d.consecutiveFutureWeeks>=2;},
   title:'Planning 2 weeks ahead',
   msg:function(n){return n+' has already planned their chores for the next two weeks. Thinking ahead is a core financial skill.';},
   advice:'Encourage them to set a chore plan at the start of every week — make it a brief ritual.'},
  {id:'plan_4wks',cat:'Planning',sentiment:'positive',priority:1,
   check:function(d){return d.consecutiveFutureWeeks>=4;},
   title:'Planning four weeks ahead',
   msg:function(n){return n+' consistently plans spending and chores four weeks ahead. You might be ready to loosen controls significantly.';},
   advice:'This is one of the strongest indicators of financial readiness. Consider giving them more autonomy over their spending decisions.'},
  {id:'long_term_goal',cat:'Planning',sentiment:'positive',priority:2,
   check:function(d){return d.maxDeadlineDays>=90;},
   title:'Long-term savings goal',
   msg:function(n,d){return n+' has set a savings goal with a deadline over 3 months away — a genuine indicator of long-term thinking.';},
   advice:'Check in monthly on progress. The act of tracking movement toward a distant goal builds patience and resilience.'},
  {id:'goal_deadlines',cat:'Planning',sentiment:'positive',priority:3,
   check:function(d){return d.goalsWithDeadlines>=1&&d.goalCount>=1;},
   title:'Goals have deadlines',
   msg:function(n){return n+' has given their savings goals a concrete deadline — time-bound goals are proven to be significantly more likely to be achieved.';},
   advice:'Ask them: "What would it mean to hit this by that date?" The emotional connection to the deadline matters.'},
  {id:'no_deadline',cat:'Planning',sentiment:'neutral',priority:3,
   check:function(d){return d.goalCount>=1&&d.goalsWithDeadlines===0;},
   title:'Goals have no deadlines',
   msg:function(n){return n+' has set savings goals but no target dates. Open-ended goals are much easier to indefinitely postpone.';},
   advice:'Help them add a realistic deadline to at least one goal. Even an approximate date makes a goal more real.'},
  {id:'no_future_plan',cat:'Planning',sentiment:'warning',priority:3,
   check:function(d){return d.consecutiveFutureWeeks===0&&d.weeksWithPlans>=2;},
   title:'Only planning the current week',
   msg:function(n){return n+' uses the planner but never looks further than the current week. All planning is reactive.';},
   advice:'Next time you review together, ask: "What do you want to earn next week too?" Extend the habit one week at a time.'},
  // ── BANKING READINESS ──────────────────────────────────────────────────────
  {id:'ready_account',cat:'Readiness',sentiment:'positive',priority:1,
   check:function(d){return d.consistencyScore>=75&&d.responsibilityScore>=75;},
   title:'Ready for a youth bank account',
   msg:function(n){return n+'\'s consistency and responsibility scores are both above 75. This is a strong signal that they would benefit from — and sensibly manage — a basic bank account.';},
   advice:'A youth account (with a card and app) makes money real in a way this app cannot. Most banks offer them from age 11.'},
  {id:'ready_autonomy',cat:'Readiness',sentiment:'positive',priority:1,
   check:function(d){return d.consistencyScore>=80&&d.responsibilityScore>=80&&d.horizonLevel>=3;},
   title:'Ready for greater financial autonomy',
   msg:function(n){return n+'\'s scores across all three dimensions are strong. They are demonstrating the kind of financial thinking that most adults aspire to.';},
   advice:'Consider removing spending limits entirely and letting natural consequences guide decisions. The learning from real stakes is irreplaceable.'},
  {id:'needs_time',cat:'Readiness',sentiment:'neutral',priority:3,
   check:function(d){return d.readinessLevel<=2&&d.weeksActive>=6;},
   title:'Still building foundations',
   msg:function(n){return n+' has been using the app for a while but the scores suggest financial habits are still forming. This is completely normal at this stage.';},
   advice:'Consistency and time are the main ingredients here. Keep the routine going rather than adding pressure.'},
  // ── PARENTAL GUIDANCE ──────────────────────────────────────────────────────
  {id:'loosen_controls',cat:'Guidance',sentiment:'positive',priority:1,
   check:function(d){return d.consistencyScore>=80&&d.responsibilityScore>=75;},
   title:'Consider loosening controls',
   msg:function(n){return n+'\'s scores are strong across the board. Maintaining tight controls now may actually undermine the autonomy they\'ve earned.';},
   advice:'Think about which controls you can remove. Autonomy with natural consequences is more educational than supervised compliance.'},
  {id:'review_match_rate',cat:'Guidance',sentiment:'neutral',priority:2,
   check:function(d){return d.goalCount>=1&&d.matchRate===0;},
   title:'No parent match rate set',
   msg:function(n){return n+' has savings goals but no parent contribution rate is configured. A small match can have a powerful motivating effect.';},
   advice:'Even matching at 10-20% signals that you value their saving behaviour. Go to Pocket Money settings to configure this.'},
  {id:'sub_check',cat:'Guidance',sentiment:'warning',priority:2,
   check:function(d){return d.activeSubCount>=3;},
   title:'Multiple active subscriptions',
   msg:function(n,d){return n+' has '+d.activeSubCount+' active subscriptions. It\'s worth reviewing whether they understand the cumulative monthly cost.';},
   advice:'Add up the total together. Ask: "Which of these would you cancel if you had to?" This builds cost-awareness.'},
  {id:'celebrate_streak',cat:'Guidance',sentiment:'positive',priority:2,
   check:function(d){return d.streak>=14;},
   title:'Milestone worth celebrating',
   msg:function(n,d){return n+'\'s current '+d.streak+'-day streak deserves explicit recognition. Celebrating consistency reinforces the behaviour at a neurological level.';},
   advice:'A specific verbal acknowledgement works better than a generic "well done" — name exactly what they\'ve done.'},
  {id:'goal_vs_spending',cat:'Guidance',sentiment:'warning',priority:2,
   check:function(d){return d.goalCount>=1&&d.spendingRate!==null&&d.spendingRate>=0.75;},
   title:'Goals and spending in conflict',
   msg:function(n){return n+' has savings goals but is spending most of their earnings. The goals are unlikely to be reached at this rate.';},
   advice:'Make the trade-off visible: "If you buy this, your [goal] moves back X weeks." Opportunity cost only lands when it\'s concrete.'},
  {id:'long_earner',cat:'Guidance',sentiment:'neutral',priority:3,
   check:function(d){return d.weeksActive>=16&&d.totalApproved>=30&&d.consistencyScore>=65;},
   title:'Time to review the arrangement',
   msg:function(n){return n+' has been consistently earning for several months. The original agreement may no longer reflect their growing capability.';},
   advice:'Consider renegotiating: higher-value chores, new responsibilities, or a larger allowance tied to maintained performance.'}
];

function generateFeedback(data){
  return FEEDBACK_LIBRARY.filter(function(item){
    try{ return item.check(data); } catch(e){ return false; }
  }).sort(function(a,b){return a.priority-b.priority;});
}

function scoreColor(n){
  if(n>=75) return'green';
  if(n>=50) return'amber';
  return'red';
}
function scoreDesc(n){
  if(n>=85) return'Excellent';
  if(n>=75) return'Strong';
  if(n>=60) return'Developing';
  if(n>=40) return'Needs attention';
  return'Low';
}

function renderProgressReport(){
  var data=calcFinancialReport();
  var loganName=data.name;
  // Update preview tiles in settings
  function previewTile(id,val,label,color){
    var el=document.getElementById(id);if(!el)return;
    el.style.background=color==='green'?'#D1FAE5':color==='amber'?'#FEF3C7':color==='red'?'#FEE2E2':'var(--gray-l)';
    el.style.border='1px solid '+(color==='green'?'#6EE7B7':color==='amber'?'#FCD34D':color==='red'?'#FCA5A5':'var(--border)');
    el.innerHTML='<div style="font-size:22px;font-weight:900;color:'+(color==='green'?'#065F46':color==='amber'?'#92400E':color==='red'?'#991B1B':'var(--muted)')+'">'+val+'</div>'+
      '<div style="font-size:10px;font-weight:800;text-transform:uppercase;color:'+(color==='green'?'#065F46':color==='amber'?'#92400E':color==='red'?'#991B1B':'var(--muted)')+';letter-spacing:.5px">'+label+'</div>';
  }
  previewTile('rp-consistency',data.consistencyScore,      'Consistency',   scoreColor(data.consistencyScore));
  previewTile('rp-responsibility',data.responsibilityScore,'Responsibility',scoreColor(data.responsibilityScore));
  previewTile('rp-horizon',data.horizonIcon,               'Horizon',       'grey');
  // Full report content
  var el=document.getElementById('report-modal-content');
  if(!el) return;
  var title=document.getElementById('report-modal-title');
  if(title) title.textContent=loganName+'\'s Financial Report';
  var noData=data.totalApproved<4&&data.totalEarned<5;
  if(noData){
    el.innerHTML='<div class="report-empty">'+data.name+' hasn\'t been active long enough to generate a reliable report. Check back after a few more weeks of engagement.</div>';
    return;
  }
  // Scores
  var html='<div class="report-scores">';
  html+='<div class="score-card '+scoreColor(data.consistencyScore)+'">'+
    '<div class="score-num">'+data.consistencyScore+'</div>'+
    '<div class="score-label">Consistency</div>'+
    '<div class="score-desc">'+scoreDesc(data.consistencyScore)+'</div>'+
  '</div>';
  html+='<div class="score-card '+scoreColor(data.responsibilityScore)+'">'+
    '<div class="score-num">'+data.responsibilityScore+'</div>'+
    '<div class="score-label">Responsibility</div>'+
    '<div class="score-desc">'+scoreDesc(data.responsibilityScore)+'</div>'+
  '</div>';
  html+='</div>';
  // Planning horizon
  html+='<div class="horizon-card">'+
    '<div class="horizon-icon">'+data.horizonIcon+'</div>'+
    '<div><div class="horizon-label">Planning horizon</div>'+
    '<div class="horizon-value">'+data.horizonLabel+'</div>'+
    '<div class="horizon-sub">'+data.horizonSub+'</div></div>'+
  '</div>';
  // Banking readiness bar
  html+='<div class="readiness-bar-wrap">'+
    '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;color:var(--muted)">Banking readiness</div>'+
    '<div class="readiness-bar-track"><div class="readiness-bar-fill" style="width:'+data.readinessPct+'%"></div></div>'+
    '<div class="readiness-labels"><span>Foundations</span><span>Guided tools</span><span>Full banking</span></div>'+
    '<div class="readiness-level">'+data.readinessLabel+'</div>'+
  '</div>';
  // Feedback
  var feedback=generateFeedback(data);
  var positive=feedback.filter(function(f){return f.sentiment==='positive';});
  var warnings=feedback.filter(function(f){return f.sentiment==='warning';});
  var neutral=feedback.filter(function(f){return f.sentiment==='neutral';});
  function fbCard(f){
    var msg=f.msg(loganName,data);
    return'<div class="feedback-card '+f.sentiment+'">'+
      '<div class="fb-title">'+(f.sentiment==='positive'?'✓ ':f.sentiment==='warning'?'⚠ ':'ℹ ')+f.title+'</div>'+
      '<div class="fb-msg">'+esc(msg)+'</div>'+
      (f.advice?'<div class="fb-advice">Suggested: '+esc(f.advice)+'</div>':'')+
    '</div>';
  }
  if(positive.length){
    html+='<div class="feedback-section-title">Positive signals</div>';
    html+=positive.map(fbCard).join('');
  }
  if(warnings.length){
    html+='<div class="feedback-section-title">Areas to watch</div>';
    html+=warnings.map(fbCard).join('');
  }
  if(neutral.length){
    html+='<div class="feedback-section-title">Worth noting</div>';
    html+=neutral.map(fbCard).join('');
  }
  if(!feedback.length){
    html+='<div class="report-empty">No specific flags to raise right now. Keep engaging!</div>';
  }
  el.innerHTML=html;
}

function openProgressReport(){
  renderProgressReport();
  openModal('modal-progress-report');
  lucide.createIcons();
}

function showBossSettingsGroup(group){`,
'JS report functions'
);

// ─────────────────────────────────────────────────────────────────────────────
// 5. JS — trigger renderProgressReport when navigating to parental settings
// ─────────────────────────────────────────────────────────────────────────────
replace(
`function showBossSettingsGroup(group){
  document.getElementById('boss-settings-home').style.display='none';
  ['profile','pocketmoney','parental','security'].forEach(function(g){
    document.getElementById('boss-settings-'+g).style.display=g===group?'':'none';
  });
  lucide.createIcons();
}`,
`function showBossSettingsGroup(group){
  document.getElementById('boss-settings-home').style.display='none';
  ['profile','pocketmoney','parental','security'].forEach(function(g){
    document.getElementById('boss-settings-'+g).style.display=g===group?'':'none';
  });
  if(group==='parental') renderProgressReport();
  lucide.createIcons();
}`,
'JS showBossSettingsGroup parental hook'
);

// ─────────────────────────────────────────────────────────────────────────────
fs.writeFileSync(path, c, 'utf8');
console.log('\nAll patches applied.');

const verify = fs.readFileSync(path, 'utf8');
console.log('modal-progress-report:', verify.includes('modal-progress-report'));
console.log('calcFinancialReport:', verify.includes('calcFinancialReport'));
console.log('FEEDBACK_LIBRARY:', verify.includes('FEEDBACK_LIBRARY'));
console.log('openProgressReport:', verify.includes('openProgressReport'));
