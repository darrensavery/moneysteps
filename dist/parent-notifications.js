// ── Parent Notification Library ─────────────────────────────────────────────
// 72 messages across consistency, responsibility, planning, and milestone triggers.
// Use matchParentNotifications() from parent-insights.js to select relevant ones.

var PARENT_NOTIFICATIONS = [

  // ============================================================
  // CONSISTENCY
  // ============================================================

  {
    id: 'consistency_excellent_01',
    category: 'consistency',
    trigger: 'consistency_excellent',
    priority: 'positive',
    short: '{name} has been earning consistently for 4 weeks straight. Brilliant! 🌟',
    long: '{name}\'s Consistency Score has stayed above 85 for a whole month. That\'s not luck — that\'s habit. They\'re showing up, doing the work, and collecting their earnings week after week. This is exactly the kind of reliable behaviour that builds real financial confidence.',
    suggestedAction: 'loosen_controls'
  },
  {
    id: 'consistency_excellent_02',
    category: 'consistency',
    trigger: 'consistency_excellent',
    priority: 'positive',
    short: 'Four weeks of top marks from {name}. They\'ve got this down pat.',
    long: 'When a child earns consistently over an extended period, it tells us something important: they\'ve internalised the routine. {name} isn\'t just doing chores when reminded — they\'re self-managing. You might feel comfortable giving them a bit more independence in how they choose and schedule their tasks.',
    suggestedAction: 'loosen_controls'
  },
  {
    id: 'consistency_excellent_03',
    category: 'consistency',
    trigger: 'consistency_excellent',
    priority: 'positive',
    short: '{name}\'s consistency is in the top tier. Could be time to raise their earning ceiling.',
    long: '{name} has proven they can handle regular responsibility with flying colours. If their current chore list feels a bit easy, this could be a great moment to introduce a new, higher-value task — giving them more earning potential while keeping the good habits going.',
    suggestedAction: 'loosen_controls'
  },
  {
    id: 'consistency_excellent_04',
    category: 'consistency',
    trigger: 'consistency_excellent',
    priority: 'positive',
    short: 'A full month of excellent earning from {name}. Worth a celebration!',
    long: 'Four consecutive weeks of high consistency is a genuine milestone for {name}. Consider acknowledging it directly — kids this age thrive when they know their effort has been noticed by the people who matter most. A simple "I\'ve been watching your app and I\'m really proud of you" can go a long way.',
    suggestedAction: null
  },

  {
    id: 'consistency_improving_01',
    category: 'consistency',
    trigger: 'consistency_improving',
    priority: 'positive',
    short: '{name}\'s consistency has jumped recently. Great momentum!',
    long: '{name}\'s Consistency Score has risen significantly over the past 30 days. Something has clicked — whether it\'s a new routine, a savings goal motivating them, or just growing maturity. Now is a great time to reinforce the behaviour with a word of encouragement before the momentum fades.',
    suggestedAction: null
  },
  {
    id: 'consistency_improving_02',
    category: 'consistency',
    trigger: 'consistency_improving',
    priority: 'positive',
    short: 'Big improvement from {name} this month — consistency is up sharply.',
    long: 'After a quieter patch, {name} has turned things around in a meaningful way. Their Consistency Score has climbed more than 15 points in the last 30 days. It\'s worth asking what\'s changed — they may have found a goal worth saving for, or simply hit their stride. Either way, this upward trend deserves to be noticed.',
    suggestedAction: null
  },
  {
    id: 'consistency_improving_03',
    category: 'consistency',
    trigger: 'consistency_improving',
    priority: 'positive',
    short: '{name} is on the up — consistency score rose sharply. Keep it going!',
    long: 'Progress like this is worth making visible to {name}. They may not realise just how much their habits have improved. Showing them the chart in the app and celebrating the upward curve together can be a powerful motivator to sustain the momentum into next month.',
    suggestedAction: null
  },

  {
    id: 'consistency_declining_01',
    category: 'consistency',
    trigger: 'consistency_declining',
    priority: 'warning',
    short: '{name}\'s consistency has dropped recently. Worth checking in.',
    long: '{name}\'s Consistency Score has fallen noticeably over the past few weeks. This doesn\'t necessarily mean anything is wrong — schedules get busy, motivation dips for everyone. But a gentle, curious conversation ("How are you finding your tasks at the moment?") can help you understand whether there\'s a barrier you could help remove.',
    suggestedAction: null
  },
  {
    id: 'consistency_declining_02',
    category: 'consistency',
    trigger: 'consistency_declining',
    priority: 'warning',
    short: 'Consistency dip for {name} this month. A quiet chat might help.',
    long: 'After a strong spell, {name}\'s earning pattern has become less regular. A drop of 20+ points in a month is worth paying attention to. Before stepping in with reminders or rules, it may be worth asking whether their current chores still feel fair and achievable — sometimes a task that felt fine at the start has become a source of quiet frustration.',
    suggestedAction: null
  },
  {
    id: 'consistency_declining_03',
    category: 'consistency',
    trigger: 'consistency_declining',
    priority: 'warning',
    short: '{name}\'s earnings have become patchy. Could be worth a check-in, {parent}.',
    long: 'Life gets busy and motivation naturally fluctuates — this isn\'t a crisis. But if the decline continues, {name} may start to disengage from the app entirely. A low-key conversation about what they\'re saving for, and whether their task list feels manageable, could help re-anchor their motivation without feeling like pressure.',
    suggestedAction: null
  },

  {
    id: 'consistency_low_01',
    category: 'consistency',
    trigger: 'consistency_low',
    priority: 'action',
    short: '{name}\'s consistency has been low for 2 weeks. They may need some support.',
    long: '{name}\'s Consistency Score has been below 30 for two weeks in a row. At this level, the habit of earning is at risk of breaking down altogether. This is a good moment to sit alongside them, open the app together, and help them pick one achievable task to start with — removing the friction of getting restarted can make a big difference.',
    suggestedAction: null
  },
  {
    id: 'consistency_low_02',
    category: 'consistency',
    trigger: 'consistency_low',
    priority: 'action',
    short: 'Very low earning activity from {name} lately. Worth sitting down together.',
    long: 'When a child\'s consistency drops this low for this long, it\'s usually a signal rather than a character flaw. {name} might be overwhelmed, disengaged, or unsure how to restart. Try reviewing their task list together — are the jobs still appropriate for their age? Is the pay still motivating? Small adjustments can reignite engagement surprisingly quickly.',
    suggestedAction: null
  },
  {
    id: 'consistency_low_03',
    category: 'consistency',
    trigger: 'consistency_low',
    priority: 'action',
    short: '{name} hasn\'t been earning much lately. A reset conversation might help.',
    long: 'Two weeks of very low activity suggests {name} has lost their connection to the app\'s routine. Rather than adding pressure, consider reframing: remind them what they were saving for, look at the goal together, and make the path forward feel concrete and exciting again. The goal is re-engagement, not compliance.',
    suggestedAction: 'set_goal'
  },

  {
    id: 'consistency_streak_01',
    category: 'consistency',
    trigger: 'consistency_streak',
    priority: 'positive',
    short: '{name} is on a 7-day earning streak! That\'s a week of solid effort.',
    long: '{name} has completed tasks and earned money every single day for the past week. A 7-day streak is a genuinely impressive show of commitment for a young person. This is a perfect moment for a quick, specific word of praise — "I saw your streak in the app, that\'s seven days in a row, I\'m really proud of you."',
    suggestedAction: null
  },
  {
    id: 'consistency_streak_02',
    category: 'consistency',
    trigger: 'consistency_streak',
    priority: 'positive',
    short: 'Seven days in a row for {name}. That streak is worth acknowledging!',
    long: 'Streaks matter because they make consistency feel tangible and rewarding. {name} has now earned something every day for a full week. Whether they\'re chasing a specific goal or just in a good rhythm, this kind of momentum is worth protecting — and celebrating. Let them know you\'ve noticed.',
    suggestedAction: null
  },

  {
    id: 'consistency_milestone_01',
    category: 'consistency',
    trigger: 'consistency_milestone',
    priority: 'positive',
    short: '{name} completed tasks every single week this month. First time ever!',
    long: 'This is a first — {name} has finished at least one task in every week of the past month. It\'s their first fully consistent month on the app. Milestones like this are worth marking: they show that a habit has genuinely formed, not just been attempted. Well done to both of you.',
    suggestedAction: 'loosen_controls'
  },
  {
    id: 'consistency_milestone_02',
    category: 'consistency',
    trigger: 'consistency_milestone',
    priority: 'positive',
    short: 'A perfect month from {name} — every week had earnings. That\'s a first!',
    long: '{name}\'s first month of complete weekly consistency is worth a proper celebration. This is the foundation that all the other good financial habits are built on. Consider marking it with something tangible — a small bonus, a matched contribution to their savings goal, or simply some quality time acknowledging their growth.',
    suggestedAction: 'add_match'
  },

  // ============================================================
  // RESPONSIBILITY
  // ============================================================

  {
    id: 'responsibility_high_01',
    category: 'responsibility',
    trigger: 'responsibility_high',
    priority: 'positive',
    short: '{name}\'s Responsibility Score is above 80. Excellent financial judgement!',
    long: '{name} is making genuinely thoughtful financial decisions — balancing spending and saving, setting goals, and following through. A Responsibility Score above 80 is a strong signal that they understand money is a tool, not just a treat. This is the kind of literacy that will serve them for life.',
    suggestedAction: 'loosen_controls'
  },
  {
    id: 'responsibility_high_02',
    category: 'responsibility',
    trigger: 'responsibility_high',
    priority: 'positive',
    short: 'High responsibility score for {name} — they\'re making smart choices.',
    long: 'When a child\'s Responsibility Score climbs above 80, it often reflects something you\'ve been modelling for them at home: that money decisions have consequences, and that a bit of patience usually pays off. {name} is demonstrating exactly that. You might feel comfortable giving them more autonomy over how they allocate their pocket money.',
    suggestedAction: 'loosen_controls'
  },
  {
    id: 'responsibility_high_03',
    category: 'responsibility',
    trigger: 'responsibility_high',
    priority: 'positive',
    short: '{name}\'s financial decision-making is excellent right now.',
    long: 'A Responsibility Score over 80 puts {name} in the top tier of app users their age. They\'re not just earning — they\'re thinking about what to do with what they earn. This is a brilliant moment to have a slightly more grown-up money conversation: ask them about their goals, their thinking, and what they\'d do with more to manage.',
    suggestedAction: null
  },

  {
    id: 'responsibility_goal_setter_01',
    category: 'responsibility',
    trigger: 'responsibility_goal_setter',
    priority: 'positive',
    short: '{name} has set 2 active savings goals with deadlines. Love the ambition!',
    long: 'Having two active, deadline-driven goals shows that {name} is thinking about the future in a concrete way. They\'re not just saving in the abstract — they\'re working toward something specific they want. This kind of purposeful saving is one of the most important financial habits a young person can develop.',
    suggestedAction: null
  },
  {
    id: 'responsibility_goal_setter_02',
    category: 'responsibility',
    trigger: 'responsibility_goal_setter',
    priority: 'positive',
    short: 'Two savings goals active with deadlines — {name} is thinking ahead!',
    long: '{name} currently has two savings goals running simultaneously, both with target dates attached. This is sophisticated planning for their age. It shows they understand that different things cost different amounts and take different amounts of time to save for — a genuinely valuable insight. Consider adding a parent match to the goal they care most about.',
    suggestedAction: 'add_match'
  },

  {
    id: 'responsibility_spender_01',
    category: 'responsibility',
    trigger: 'responsibility_spender',
    priority: 'warning',
    short: '{name} has spent over 80% of earnings this month. Worth a chat.',
    long: '{name} has spent more than 80% of what they\'ve earned this month, leaving very little for saving. This isn\'t necessarily a problem — spending is part of the point — but it may be worth a gentle conversation about whether there\'s anything they\'re working toward. Sometimes a spending pattern like this means there\'s no active goal to anchor saving behaviour.',
    suggestedAction: 'set_goal'
  },
  {
    id: 'responsibility_spender_02',
    category: 'responsibility',
    trigger: 'responsibility_spender',
    priority: 'warning',
    short: 'Most of {name}\'s earnings went straight out this month. Any savings goals set?',
    long: 'High spending as a proportion of earnings can be completely normal — but when it happens consistently, it\'s a useful prompt to check whether {name} has something worth saving for. Try asking them: "Is there anything you really want that would take a few weeks to save for?" Having a goal in mind often naturally shifts the spend/save balance.',
    suggestedAction: 'set_goal'
  },
  {
    id: 'responsibility_spender_03',
    category: 'responsibility',
    trigger: 'responsibility_spender',
    priority: 'warning',
    short: '{name} spent 80%+ of earnings this month. A savings goal could help redirect.',
    long: 'Without a compelling goal, it\'s very natural for children to spend as they go — the reward is immediate and the cost of not saving is invisible. If {name} doesn\'t have an active savings target, helping them identify something meaningful to work toward could shift their behaviour significantly.',
    suggestedAction: 'set_goal'
  },

  {
    id: 'responsibility_saver_01',
    category: 'responsibility',
    trigger: 'responsibility_saver',
    priority: 'positive',
    short: '{name} is consistently saving over 40% of earnings. Impressive discipline!',
    long: '{name} has been saving more than 40% of their earnings consistently — that\'s a rate many adults struggle to match. This kind of deliberate saving, especially when sustained over time, is a real indicator of financial maturity. If you haven\'t already added a parent match, now would be a wonderful time to do so.',
    suggestedAction: 'add_match'
  },
  {
    id: 'responsibility_saver_02',
    category: 'responsibility',
    trigger: 'responsibility_saver',
    priority: 'positive',
    short: 'Saving 40%+ of earnings consistently — {name} is building real financial muscle.',
    long: 'The habit of saving a meaningful proportion of income is one of the most powerful financial behaviours there is. {name} is developing it now, at exactly the right age for it to become second nature. Let them know you\'ve noticed — and if they have a specific goal they\'re working toward, consider rewarding their discipline with a contribution.',
    suggestedAction: 'add_match'
  },

  {
    id: 'responsibility_rejection_spike_01',
    category: 'responsibility',
    trigger: 'responsibility_rejection_spike',
    priority: 'warning',
    short: '{name} has had 3+ task rejections in 2 weeks. Worth a conversation.',
    long: 'Three or more task rejections in a short period can mean a few different things: the standards expected may not be clear, {name} may be rushing to collect the reward, or there may be friction with a specific task. Before attributing it to attitude, it\'s worth checking whether the criteria for each job are as clear to {name} as they are to you.',
    suggestedAction: null
  },
  {
    id: 'responsibility_rejection_spike_02',
    category: 'responsibility',
    trigger: 'responsibility_rejection_spike',
    priority: 'warning',
    short: 'Several task rejections for {name} recently. Expectations may need clarifying.',
    long: 'A spike in rejections is most often a communication issue rather than a motivation one. {name} may genuinely not know what "done properly" looks like for a particular task. A quick show-and-tell — actually doing the task together once and explaining what you\'re looking for — tends to resolve rejection cycles much more effectively than reminders.',
    suggestedAction: null
  },
  {
    id: 'responsibility_rejection_spike_03',
    category: 'responsibility',
    trigger: 'responsibility_rejection_spike',
    priority: 'warning',
    short: 'Three rejections in two weeks for {name}. Could the standards be clearer?',
    long: 'Repeated rejections can quietly erode a child\'s motivation — if they feel like they can\'t win, they may stop trying. Before this cycle takes hold, it\'s worth a specific, positive conversation: "Here\'s exactly what I need to see for this to be approved." Concrete, observable criteria make a real difference.',
    suggestedAction: null
  },

  {
    id: 'responsibility_quality_decline_01',
    category: 'responsibility',
    trigger: 'responsibility_quality_decline',
    priority: 'warning',
    short: 'Three thumbs-down ratings for {name} recently. Quality may be slipping.',
    long: 'Three low-quality ratings in a fortnight suggests {name}\'s effort levels may have dropped, or that they\'re completing tasks in a rush. This is worth addressing sooner rather than later — a pattern of low-quality work, if left unchecked, can undermine the whole value of the chore-earning system.',
    suggestedAction: null
  },
  {
    id: 'responsibility_quality_decline_02',
    category: 'responsibility',
    trigger: 'responsibility_quality_decline',
    priority: 'warning',
    short: 'Job quality has dipped for {name} — a few thumbs-down recently.',
    long: 'It\'s not unusual for effort to slip once a task becomes familiar — the novelty wears off and the minimum effort needed to "pass" becomes the default. If {name} has been doing the same tasks for a while, this might be a sign that it\'s time to refresh their list.',
    suggestedAction: null
  },
  {
    id: 'responsibility_quality_decline_03',
    category: 'responsibility',
    trigger: 'responsibility_quality_decline',
    priority: 'warning',
    short: '{name}\'s task quality is dropping. Time to reset expectations together.',
    long: 'Quality ratings give {name} honest, timely feedback on their work — which is itself a valuable life lesson. Rather than treating a quality dip as a discipline issue, you could use it as a learning conversation: "What do you think makes this job a 5-star effort? Let\'s figure it out together."',
    suggestedAction: null
  },

  {
    id: 'responsibility_initiative_01',
    category: 'responsibility',
    trigger: 'responsibility_initiative',
    priority: 'positive',
    short: '{name} suggested a new job and got it approved. That\'s real initiative!',
    long: 'This is a lovely development — {name} didn\'t wait to be assigned work, they identified something worth doing and proposed it themselves. That\'s a level of ownership and initiative that goes well beyond completing assigned chores. It\'s worth making a big deal of this: the behaviour you celebrate is the behaviour you get more of.',
    suggestedAction: 'loosen_controls'
  },
  {
    id: 'responsibility_initiative_02',
    category: 'responsibility',
    trigger: 'responsibility_initiative',
    priority: 'positive',
    short: '{name} proposed their own job and it was approved. Entrepreneurial thinking!',
    long: 'When a child starts identifying opportunities rather than waiting for them to be handed out, something important has shifted in how they relate to earning. {name} has shown they understand that value creation is an active process. This kind of thinking, nurtured now, tends to show up in every area of their life as they grow.',
    suggestedAction: 'loosen_controls'
  },

  // ============================================================
  // PLANNING HORIZON
  // ============================================================

  {
    id: 'planning_long_01',
    category: 'planning',
    trigger: 'planning_long',
    priority: 'positive',
    short: '{name} is planning more than 8 weeks ahead. Excellent long-term thinking!',
    long: 'A Planning Horizon of over 8 weeks means {name} is capable of deferring short-term gratification for a longer-term reward — one of the strongest predictors of financial wellbeing we know of. They\'re thinking in months, not just days. This is a genuinely impressive developmental milestone and deserves to be acknowledged.',
    suggestedAction: 'loosen_controls'
  },
  {
    id: 'planning_long_02',
    category: 'planning',
    trigger: 'planning_long',
    priority: 'positive',
    short: 'Planning 8+ weeks ahead — {name} is thinking like a financial grown-up.',
    long: 'Long-horizon planning is rare at {name}\'s age. Most children (and many adults) operate primarily on a weekly or even daily cycle. The fact that {name} is setting goals with timelines stretching beyond two months shows a real capacity for strategic thinking.',
    suggestedAction: 'add_match'
  },
  {
    id: 'planning_long_03',
    category: 'planning',
    trigger: 'planning_long',
    priority: 'positive',
    short: '{name}\'s planning horizon is 8+ weeks. The big-picture thinking is impressive.',
    long: '{name} is not just earning and spending — they\'re thinking ahead. Goals with horizons over 8 weeks require sustained motivation and a genuine understanding of how small regular contributions add up over time. These are the foundations of real financial literacy.',
    suggestedAction: 'add_match'
  },

  {
    id: 'planning_medium_01',
    category: 'planning',
    trigger: 'planning_medium',
    priority: 'info',
    short: '{name} is planning 4-8 weeks ahead — solid medium-term thinking.',
    long: '{name}\'s Planning Horizon sits comfortably in the medium range — they\'re thinking beyond the immediate week but haven\'t quite stretched into longer-term goal-setting yet. This is a healthy, normal stage. If they\'re motivated by a goal they\'re close to hitting, it\'s a great moment to encourage them to set their next, more ambitious one.',
    suggestedAction: 'set_goal'
  },
  {
    id: 'planning_medium_02',
    category: 'planning',
    trigger: 'planning_medium',
    priority: 'info',
    short: '{name} is thinking 4-8 weeks ahead. Good foundations — room to stretch further.',
    long: 'A medium planning horizon is a solid place to be. {name} has the patience to save toward goals that take more than a few days, which is a real skill. To nudge their thinking further out, try asking "Is there anything bigger you\'d love to have or do by the end of the year?"',
    suggestedAction: 'set_goal'
  },

  {
    id: 'planning_short_01',
    category: 'planning',
    trigger: 'planning_short',
    priority: 'warning',
    short: '{name}\'s planning horizon is under 2 weeks. Mostly spending in the short-term.',
    long: '{name} is currently living very much in the present — earning and spending within a very short window. This is developmentally normal for younger children, but if they\'re old enough to benefit from longer-horizon thinking, it\'s worth introducing the idea of a goal that takes a bit longer to reach.',
    suggestedAction: 'set_goal'
  },
  {
    id: 'planning_short_02',
    category: 'planning',
    trigger: 'planning_short',
    priority: 'warning',
    short: '{name} is only thinking 1-2 weeks ahead. A new goal might help stretch this.',
    long: 'Short planning horizons are common when children don\'t have a compelling goal to anchor their saving. The money feels abstract without something specific to aim for. The most effective intervention is usually the simplest one: sit down together and help them pick something achievable but requiring a bit of patience.',
    suggestedAction: 'set_goal'
  },
  {
    id: 'planning_short_03',
    category: 'planning',
    trigger: 'planning_short',
    priority: 'warning',
    short: 'Short-term focus from {name} at the moment. Worth exploring a bigger goal.',
    long: 'When {name}\'s Planning Horizon sits below two weeks, it usually means they\'re in a spend-as-you-go pattern without a meaningful savings target. Even a modest goal — something 6-8 weeks away — can dramatically shift how they think about and manage their money.',
    suggestedAction: 'set_goal'
  },

  {
    id: 'planning_deadline_achiever_01',
    category: 'planning',
    trigger: 'planning_deadline_achiever',
    priority: 'positive',
    short: '{name} is on track to hit their savings goal on time. Brilliant planning!',
    long: '{name} is saving at exactly the right rate to meet their goal deadline. This is the result of consistent earning, disciplined spending, and realistic goal-setting — three things working together. Let them know they\'re on track: seeing the finish line approaching is a powerful motivator.',
    suggestedAction: null
  },
  {
    id: 'planning_deadline_achiever_02',
    category: 'planning',
    trigger: 'planning_deadline_achiever',
    priority: 'positive',
    short: 'On track to hit the savings deadline — {name}\'s plan is working perfectly.',
    long: 'There\'s no better feeling than watching a plan come together. {name}\'s current saving rate puts them right on course to reach their goal by the date they set. This is a wonderful moment to help them appreciate the connection between consistent effort and achieving what they set out to do.',
    suggestedAction: null
  },

  {
    id: 'planning_deadline_at_risk_01',
    category: 'planning',
    trigger: 'planning_deadline_at_risk',
    priority: 'action',
    short: '{name} is behind pace for their savings goal. The deadline is at risk.',
    long: 'At {name}\'s current saving rate, they\'re unlikely to hit their goal by the deadline they set. This isn\'t a crisis — it\'s a learning opportunity. The options are: earn more, spend less, extend the deadline, or adjust the goal. Working through those options together teaches something very valuable about adapting plans.',
    suggestedAction: null
  },
  {
    id: 'planning_deadline_at_risk_02',
    category: 'planning',
    trigger: 'planning_deadline_at_risk',
    priority: 'action',
    short: 'Goal deadline at risk for {name}. Now\'s the time to review the plan together.',
    long: 'A goal that\'s falling behind schedule is actually one of the most teachable moments the app can offer. Sit down with {name} and look at the numbers honestly: how much is needed, how much time is left, what needs to change? The conversation itself is as valuable as whatever decision you reach.',
    suggestedAction: null
  },
  {
    id: 'planning_deadline_at_risk_03',
    category: 'planning',
    trigger: 'planning_deadline_at_risk',
    priority: 'action',
    short: '{name} won\'t hit their goal at this rate. Time to adjust the plan.',
    long: 'The gap between {name}\'s current saving rate and what\'s needed to hit their deadline is growing. You could help close it with a parent match contribution — or use this as a natural prompt to help {name} choose between adjusting their timeline, increasing their earnings, or scaling back some spending.',
    suggestedAction: 'add_match'
  },

  {
    id: 'planning_no_goals_01',
    category: 'planning',
    trigger: 'planning_no_goals',
    priority: 'action',
    short: '{name} has no active savings goals right now. Worth setting one together.',
    long: 'Without a savings goal, the app becomes primarily a spending tracker — and the deeper lessons about deferred gratification and purposeful saving get missed. {name} might simply not know what they want right now, or they may have finished a goal and not set a new one. A 5-minute conversation to identify something worth saving for could unlock a lot.',
    suggestedAction: 'set_goal'
  },
  {
    id: 'planning_no_goals_02',
    category: 'planning',
    trigger: 'planning_no_goals',
    priority: 'action',
    short: 'No savings goals active for {name}. Let\'s find something to aim for!',
    long: 'Goals are the engine of the whole system — they give earning a purpose and make spending decisions more intentional. {name} is currently goal-free, which means they\'re likely spending most of what they earn without much thought. Help them browse their wishlist or think about something they\'d love to experience, own, or do.',
    suggestedAction: 'set_goal'
  },

  // ============================================================
  // MILESTONE & COMBINED
  // ============================================================

  {
    id: 'first_goal_complete_01',
    category: 'milestone',
    trigger: 'first_goal_complete',
    priority: 'positive',
    short: '{name} just hit their first savings goal! This is a big deal.',
    long: 'Completing a savings goal for the first time is a genuinely landmark moment. {name} set a target, worked toward it consistently, and got there. That experience — of wanting something, making a plan, and achieving it through your own effort — is formative. Celebrate it properly, and help them set their next goal while the feeling is fresh.',
    suggestedAction: 'set_goal'
  },
  {
    id: 'first_goal_complete_02',
    category: 'milestone',
    trigger: 'first_goal_complete',
    priority: 'positive',
    short: 'Goal reached! {name} saved up and did it. Congratulations to you both!',
    long: 'This is what it\'s all for — {name} has successfully saved toward a goal and reached it. The discipline, patience, and consistency that got them here are qualities worth naming out loud. Ask them: "How does it feel to have saved for this yourself?" That reflection turns a transaction into a lasting lesson.',
    suggestedAction: null
  },
  {
    id: 'first_goal_complete_03',
    category: 'milestone',
    trigger: 'first_goal_complete',
    priority: 'positive',
    short: '{name} completed their savings goal. Time to set the next one!',
    long: 'The window right after completing a goal is one of the highest-motivation moments in a child\'s saving journey. {name} is feeling the reward of having planned and succeeded. Strike while the iron\'s hot: set a new goal together today, and let the positive feeling from this one carry them into the next challenge.',
    suggestedAction: 'set_goal'
  },

  {
    id: 'consistent_and_responsible_01',
    category: 'milestone',
    trigger: 'consistent_and_responsible',
    priority: 'positive',
    short: 'Both scores above 75 for {name} — earning well and spending wisely!',
    long: 'High scores in both Consistency and Responsibility together represent the ideal combination: {name} is earning regularly AND making good decisions about what to do with their money. This dual strength is rare and worth celebrating. They\'ve shown they can be trusted with more independence.',
    suggestedAction: 'loosen_controls'
  },
  {
    id: 'consistent_and_responsible_02',
    category: 'milestone',
    trigger: 'consistent_and_responsible',
    priority: 'positive',
    short: '{name} is both consistent and responsible. That\'s a powerful combination.',
    long: 'Consistency without responsibility can lead to earning a lot and spending it all. Responsibility without consistency can mean good intentions that don\'t materialise. Having both scores above 75 at the same time means {name} has achieved the balance that real financial health is built on.',
    suggestedAction: 'loosen_controls'
  },
  {
    id: 'consistent_and_responsible_03',
    category: 'milestone',
    trigger: 'consistent_and_responsible',
    priority: 'positive',
    short: 'Solid scores across the board for {name} — they\'re really getting it.',
    long: 'It takes time to build both the habit of earning and the wisdom to manage money well — and {name} is demonstrating both at once. They\'re showing up reliably and making thoughtful choices. This is a great moment to have a more grown-up conversation about how your own family approaches money.',
    suggestedAction: null
  },

  {
    id: 'ready_for_banking_01',
    category: 'milestone',
    trigger: 'ready_for_banking',
    priority: 'positive',
    short: '{name} is ready for a real bank account. They\'ve earned this milestone! 🏦',
    long: '{name} has hit all three markers: consistent earning (80+), responsible decision-making (75+), and a planning horizon over 6 weeks. This is the milestone the app is designed to build toward — and {name} has achieved it. It may be time to open a real bank account in their name. The skills they\'ve built here will transfer directly.',
    suggestedAction: 'loosen_controls'
  },
  {
    id: 'ready_for_banking_02',
    category: 'milestone',
    trigger: 'ready_for_banking',
    priority: 'positive',
    short: 'Banking milestone reached! {name} has the skills for a real account. 🏦',
    long: 'This is the moment you\'ve been working toward together. {name}\'s Consistency Score is above 80, their Responsibility Score is above 75, and they\'re planning more than 6 weeks ahead — all at the same time. These aren\'t just numbers. They represent real habits. {name} is ready for the next step: a junior bank account, managed primarily by them with your oversight.',
    suggestedAction: 'loosen_controls'
  },
  {
    id: 'ready_for_banking_03',
    category: 'milestone',
    trigger: 'ready_for_banking',
    priority: 'positive',
    short: '{name} has all three green lights. Time to talk about a bank account, {parent}.',
    long: 'Reaching the banking milestone takes consistency, responsibility, and genuine forward planning — all at once. {name} has done all three. This is a landmark moment in their financial journey, and one worth marking with a real-world step: opening a bank account puts everything they\'ve learned into practice in the wider world. They\'ve earned this.',
    suggestedAction: 'loosen_controls'
  },
  {
    id: 'ready_for_banking_04',
    category: 'milestone',
    trigger: 'ready_for_banking',
    priority: 'positive',
    short: 'All three milestones hit by {name}. The banking conversation starts now. 🏦',
    long: 'Consistency above 80. Responsibility above 75. Planning Horizon above 6 weeks. {name} has demonstrated, over a sustained period, that they can earn reliably, make thoughtful financial decisions, and think ahead. These are the exact behaviours that translate to success with real banking. Celebrate this — and then take the next step together.',
    suggestedAction: 'loosen_controls'
  },

  {
    id: 'spending_concern_01',
    category: 'milestone',
    trigger: 'spending_concern',
    priority: 'action',
    short: '{name}\'s subscriptions and spending now exceed their earnings. Worth reviewing.',
    long: 'This month, {name}\'s total outgoings — including subscriptions — are higher than their total earnings. This is a real-world financial concept: spending more than you earn is unsustainable. Rather than simply cutting things off, this is a valuable teaching moment. Sit down together, list everything going out, and help {name} choose what\'s worth keeping.',
    suggestedAction: 'review_spending'
  },
  {
    id: 'spending_concern_02',
    category: 'milestone',
    trigger: 'spending_concern',
    priority: 'action',
    short: 'Spending plus subscriptions is outpacing {name}\'s earnings. Time for a review.',
    long: 'When outgoings exceed income — even at pocket money scale — it\'s the perfect moment to introduce the concept of a budget. {name} needs to either earn more or spend less, and the choice of which to prioritise is a genuinely important one for them to make. Use the app\'s spending breakdown together.',
    suggestedAction: 'review_spending'
  },
  {
    id: 'spending_concern_03',
    category: 'milestone',
    trigger: 'spending_concern',
    priority: 'action',
    short: '{name} is spending more than they earn this month — a good money chat awaits.',
    long: 'Running a deficit — even a small one — is one of life\'s most powerful financial lessons, and {name} is experiencing it firsthand. This is not a failure; it\'s an opportunity. Help them understand what\'s happened in simple, factual terms, then work through it together: what comes in, what goes out, and what has to change.',
    suggestedAction: 'review_spending'
  },

  {
    id: 'improvement_after_concern_01',
    category: 'milestone',
    trigger: 'improvement_after_concern',
    priority: 'positive',
    short: '{name}\'s scores have improved since our last concern alert. Great turnaround!',
    long: 'After a difficult patch, {name} has turned things around. Their scores have improved meaningfully since the last concern notification — a real sign of resilience and responsiveness. Whatever conversation you had clearly had an effect. This kind of bounce-back is worth naming explicitly.',
    suggestedAction: null
  },
  {
    id: 'improvement_after_concern_02',
    category: 'milestone',
    trigger: 'improvement_after_concern',
    priority: 'positive',
    short: 'Bounce-back from {name} — scores are up after a tough spell. Well done!',
    long: 'Not every child responds to a dip in performance with renewed effort — but {name} has. After a period where things weren\'t going well, their scores have climbed back up. This kind of recovery demonstrates something important: that setbacks are temporary, and consistent effort really does produce results.',
    suggestedAction: 'loosen_controls'
  },

  {
    id: 'long_inactivity_01',
    category: 'milestone',
    trigger: 'long_inactivity',
    priority: 'action',
    short: '{name} hasn\'t completed any tasks in 10 days. A gentle nudge might help.',
    long: 'Ten days without any completions is a significant gap. Rather than addressing the absence directly, try approaching it with curiosity and warmth: "Fancy doing a quick one together this afternoon?" A low-barrier re-entry is almost always more effective than a conversation about why they stopped.',
    suggestedAction: null
  },
  {
    id: 'long_inactivity_02',
    category: 'milestone',
    trigger: 'long_inactivity',
    priority: 'action',
    short: 'No activity from {name} for 10+ days. Worth reaching out, {parent}.',
    long: 'Extended inactivity can signal a range of things — busyness, disengagement, a goal that no longer feels compelling, or something unrelated to the app entirely. The goal right now isn\'t to diagnose the cause; it\'s to gently lower the barriers to getting started again. One completed task breaks the inertia.',
    suggestedAction: 'set_goal'
  },
  {
    id: 'long_inactivity_03',
    category: 'milestone',
    trigger: 'long_inactivity',
    priority: 'action',
    short: '{name} has gone quiet for 10+ days. Their savings goal may need refreshing.',
    long: 'When a child who was previously active suddenly goes quiet, it often means the goal that was motivating them no longer feels exciting or achievable. If {name}\'s active goal has stalled, refreshing or replacing it might be just the restart they need. Ask them what they\'d most like to have or do in the next month or two.',
    suggestedAction: 'set_goal'
  },

  {
    id: 'parent_match_approaching_01',
    category: 'milestone',
    trigger: 'parent_match_approaching',
    priority: 'positive',
    short: '{name} is nearly at their goal — and your match is nearly triggered!',
    long: '{name} is within 20% of hitting their savings goal, which means your parent match contribution is nearly in play. This is a great moment to let them know it\'s coming — telling them "you\'re almost there, and when you hit the target I\'m going to add my match" can provide a powerful final push.',
    suggestedAction: null
  },
  {
    id: 'parent_match_approaching_02',
    category: 'milestone',
    trigger: 'parent_match_approaching',
    priority: 'positive',
    short: 'Goal in sight for {name} — within 20% with your match waiting. Nearly there!',
    long: 'The finish line is close. {name}\'s savings are within 20% of their goal, and with your parent match enabled, the reward will be even sweeter when they cross it. If they\'ve hit a slow patch, now is the moment to remind them how close they are.',
    suggestedAction: null
  },
  {
    id: 'parent_match_approaching_03',
    category: 'milestone',
    trigger: 'parent_match_approaching',
    priority: 'positive',
    short: '{name}\'s goal is almost reached — your parent match is about to kick in!',
    long: 'With {name} now within 20% of their savings target, the parent match you set up is about to come into play. This is a powerful moment — not just financially, but emotionally. It demonstrates to {name} that their effort is valued and supported, and that the adults in their life are invested in their goals.',
    suggestedAction: null
  }

];
