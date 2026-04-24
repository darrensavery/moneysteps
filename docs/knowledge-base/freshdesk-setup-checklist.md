# Freshdesk Setup Checklist

Complete these steps in the Freshdesk admin panel after creating your account at `morechard.freshdesk.com`.

---

## 1. Create article categories and folders

**Category: For Parents**

Create these 12 folders in order:
- [ ] Getting Started
- [ ] Chores & Approvals
- [ ] Pocket Money & Your Permanent Record
- [ ] Goals & Savings
- [ ] Shared Expenses
- [ ] The Learning Lab
- [ ] The AI Mentor
- [ ] Co-Parenting & The Shield Plan
- [ ] Billing & Subscriptions
- [ ] Safety & Privacy
- [ ] Troubleshooting
- [ ] Settings & Account

**Category: For Children**

Create these 6 folders in order:
- [ ] Getting Started
- [ ] Chores
- [ ] My Earnings
- [ ] Saving for Goals
- [ ] Getting Paid
- [ ] Learning & Modules

---

## 2. Paste articles into Freshdesk

Article source files are in `docs/knowledge-base/`. Each file maps to one Freshdesk folder:

| File | Freshdesk folder |
|------|-----------------|
| `parent-01-getting-started.md` | For Parents > Getting Started |
| `parent-02-chores-approvals.md` | For Parents > Chores & Approvals |
| `parent-03-pocket-money-ledger.md` | For Parents > Pocket Money & Your Permanent Record |
| `parent-04-goals-savings.md` | For Parents > Goals & Savings |
| `parent-05-shared-expenses.md` | For Parents > Shared Expenses |
| `parent-06-learning-lab.md` | For Parents > The Learning Lab |
| `parent-07-ai-mentor.md` | For Parents > The AI Mentor |
| `parent-08-coparenting-shield.md` | For Parents > Co-Parenting & The Shield Plan |
| `parent-09-billing-subscriptions.md` | For Parents > Billing & Subscriptions |
| `parent-10-safety-privacy.md` | For Parents > Safety & Privacy |
| `parent-11-troubleshooting.md` | For Parents > Troubleshooting |
| `parent-12-settings-account.md` | For Parents > Settings & Account |
| `child-01-getting-started.md` | For Children > Getting Started |
| `child-02-chores.md` | For Children > Chores |
| `child-03-my-earnings.md` | For Children > My Earnings |
| `child-04-saving-goals.md` | For Children > Saving for Goals |
| `child-05-getting-paid.md` | For Children > Getting Paid |
| `child-06-learning-modules.md` | For Children > Learning & Modules |

Each `## Article Title` heading in the file = one Freshdesk article. Create one article per heading, paste the content beneath it.

**Tagging:**
- [ ] Tag all For Parents articles with: `role_parent`
- [ ] Tag all For Children articles with: `role_child`

---

## 3. Configure the Help Widget

- [ ] Go to **Admin → Help Widget → Create Widget**
- [ ] Name it "Morechard Help"
- [ ] Enable: **Suggest articles before contact form** (this is the ticket deflection feature)
- [ ] Set default article filter to: `role_parent`
- [ ] Copy the **Widget ID** (a numeric ID shown on the embed screen)

---

## 4. Replace the widget ID placeholder in the app

After getting your Widget ID from step 3:

- [ ] Open `app/index.html`
- [ ] Replace both occurrences of `FRESHDESK_WIDGET_ID` with your real widget ID (it is a number, e.g. `12345678`)
- [ ] Commit:
  ```bash
  git add app/index.html
  git commit -m "feat(widget): set real Freshdesk widget ID"
  git push
  ```

---

## 5. Configure the Contact Form — Uproot safeguard

- [ ] Go to **Admin → Ticket Fields**
- [ ] Add a new **Dropdown** field labelled: `Reason for Contact`
- [ ] Add these options at minimum:
  - General question
  - Billing issue
  - Technical problem
  - Delete my account / Uproot
  - Other
- [ ] Go to **Admin → Automations → Ticket Creation → New Rule**
- [ ] Set rule:
  - **IF** `Reason for Contact` **is** `Delete my account / Uproot`
  - **THEN** append to description: `"Warning: Uprooting your account permanently erases your Permanent Record, including all Shield Plan data. This cannot be recovered. Please read the Uproot guide before our team processes this request."`

---

## 6. Enable Polish locale (when ready)

- [ ] Go to **Admin → Portal Settings → Languages**
- [ ] Enable **Polish (pl)**
- [ ] As PL articles are translated (replacing `[PL — PENDING TRANSLATION]` placeholders), publish them under the Polish locale in each folder

---

## 7. Verify end-to-end

- [ ] Open the Morechard app (deployed build, not local dev — widget script won't load from `localhost` in most setups)
- [ ] Tap the **?** help icon in the bottom nav
- [ ] Confirm the widget opens as a slide-up panel
- [ ] Search for an article — confirm results appear
- [ ] Confirm parent session shows parent articles; child session shows child articles
- [ ] Submit a test contact form — confirm ticket appears in Freshdesk inbox
- [ ] Test the Uproot dropdown option — confirm the disclaimer text is appended automatically
