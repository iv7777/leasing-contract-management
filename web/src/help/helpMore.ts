/** Extra help content layered on top of the `help.*` translations: a short
 * "common tasks" list per topic, and full text for topics that translations
 * don't cover (a new tab). Kept as typed data per language so a topic can be
 * extended without touching the translation tree. */

export interface HelpExtra {
  title?: string;
  body?: string;
  tips?: string[];
  steps?: string[];
}

type Lang = "en" | "zh";

export const helpMore: Record<Lang, Record<string, HelpExtra>> = {
  en: {
    dashboard: {
      steps: [
        "Start with **Overdue**: expand a tenant's row to see each unpaid bill, then follow up with the tenant.",
        "When money arrives, click the contract number → **Receipts** → **Record payment**.",
        "Check **Meter readings missing** and enter them on the contract's **Usage entries** tab.",
        "Use the yellow and blue boxes to find deposit shortfalls and contracts not yet on automatic billing.",
      ],
    },
    "properties.list": {
      steps: [
        "Admin: **Add property** and enter its name and address.",
        "Click a row to open the property and add its units.",
        "Turn on **Show archived** to see archived properties. A property can't be archived while a draft or active contract still covers one of its units.",
      ],
    },
    "properties.detail": {
      steps: [
        "Add each rentable space with **Add unit** (label, type, rentable area).",
        "Retire a unit that can no longer be rented instead of deleting it.",
        "Upload title deeds, permits and floor plans on the **Documents** tab.",
      ],
    },
    "parties.list": {
      steps: [
        "**Add party**: choose Company or Individual and enter contact details.",
        "Admin: record ID / licence numbers in the party's protected section.",
        "A party used on a contract can't be deleted — archive it instead.",
        "Click a contract number in the list to open that contract.",
      ],
    },
    "contracts.list": {
      steps: [
        "**Add contract** (Admin / Manager) creates a draft; fill its tabs, then an Admin activates it.",
        "Use the filter to see one tenant's or landlord's contracts; **Clear filter** removes it.",
        "A red tag means overdue money — click the row to see which bills.",
        "An Admin can archive an **expired or terminated** contract (once nothing is owed and the deposit is settled); turn on **Show archived** to see them.",
        "**Export CSV** downloads the list.",
      ],
    },
    "contracts.detail": {
      steps: [
        "Draft: fill in **Units**, **Pricing**, **Concessions**, **Deposit** and **Documents**, then an Admin presses **Activate**.",
        "Active: change terms only through **Amendments**.",
        "See the bills on **Charges** and what's coming on **Not billed yet**.",
        "Record money received on **Receipts**.",
        "Pressing **Activate** checks the draft and lists anything to fix first (no units or fees, overlapping rates, a deposit with no amount…).",
      ],
    },
    "contracts.detail.units": {
      steps: ["**Add unit**: pick the unit and enter the contracted area.", "Give a later-joining unit its own start date.", "After activation, add units through an amendment.", "The area must be more than zero and no more than the unit's rentable area; a unit can't be on two draft or active contracts for the same dates."],
    },
    "contracts.detail.pricing": {
      steps: [
        "**Add pricing stream** for each recurring fee (rent, management, electricity…).",
        "Choose the calculation method and the rate basis (per month, per sqm per month…).",
        "Add several rate rows over time for stepped rent.",
        "For a per-sqm fee, link only the units it applies to.",
      ],
    },
    "contracts.detail.concessions": {
      steps: ["**Add concession**: give the date range and the discount (100% = free).", "Pick one fee, or leave it blank to cover every fee.", "Enter past free-rent periods before running Catch up billing."],
    },
    "contracts.detail.deposit": {
      steps: [
        "**Set deposit terms**: a fixed amount, or a formula such as “3 months' rent” (checked by hand).",
        "**Record transaction** → type Receipt when deposit money arrives.",
        "Admin: refund, deduct, or transfer deposit to rent — each needs a reason.",
        "Orange tag / dot = deposit short.",
      ],
    },
    "contracts.detail.statement": {
      steps: ["Pick a month with the calendar.", "Check: opening balance + new bills − payments = closing balance.", "Unallocated credit is listed separately."],
    },
    "contracts.detail.receipts": {
      steps: [
        "**Record payment**: date, amount and method — it is applied to the oldest unpaid bills.",
        "**Bulk payments** enters many past payments at once, in date order.",
        "**Allocate** puts leftover credit onto a bill later.",
        "The **pencil** corrects a payment for 24 hours after you saved it (you, or an Admin).",
        "Admin: **Reverse** a wrong receipt (a reason is required).",
        "A bank reference can only be used once per contract, and the received date can't be in the future.",
      ],
    },
    "contracts.detail.usage": {
      steps: ["**Meter readings grid**: type each month's quantity for every metered fee, then save.", "**Record usage** adds a single reading — **Last month** / **This month** fill the service dates, and the unit is prefilled (kWh for electricity, m³ for water).", "A billed reading can still be corrected for 24 hours (if no payment is on its bill) — saving remakes the bill.", "A reading covers one whole calendar month — the grid does this for you."],
    },
    "contracts.detail.charges": {
      steps: [
        "Admin: **Catch up billing** previews, then creates, every bill since the lease began and turns automatic billing on.",
        "**Generate charges** creates one month by hand (needed for quarterly / yearly contracts).",
        "Admin: **Void** a mistaken bill with a reason.",
        "A red dot on this tab means overdue money.",
      ],
    },
    "contracts.detail.upcoming": {
      title: "Not billed yet",
      body: "A forecast of the bills the system will create from this contract's terms, falling due through the end of next month, with each amount and due date. Nothing here is owed yet — a bill only exists once it falls due. Contracts not yet on automatic billing show what's still ahead; their unbilled history is handled by Catch up billing on the Charges tab.",
      tips: [
        "Amounts are a forecast: if a rate changes before the due date (for example through an approved amendment), the figure changes with it.",
        "Metered fees (electricity, water) appear only after the month's reading is entered; missing readings are listed at the top.",
        "Quarterly and yearly contracts can't be forecast here — their bills are generated by hand on the Charges tab.",
      ],
      steps: ["Check the total and due dates to know what to collect next.", "Enter any missing readings so those fees appear.", "If automatic billing is off, ask an Admin to use Catch up billing."],
    },
    "contracts.detail.amendments": {
      steps: [
        "**Propose amendment**: choose what changes, the effective date and the reason.",
        "Attach the signed supplement — it is required.",
        "Submit; an Admin approves or rejects (an Admin's own proposal is approved at once).",
        "Approval creates a new version of the contract.",
        "To change due-date or late-fee rules on an active contract, choose **Due date and late-fee rules**.",
      ],
    },
    "contracts.detail.documents": {
      steps: ["**Upload document**: choose the type and Ordinary or Sensitive.", "The **Signed lease** is required before the contract can be activated.", "Sensitive files (ID copies) can only be opened by an Admin.", "Accepted: PDF, images, Word and Excel up to 50 MB. For staff who may not see an ID, upload a masked copy as Ordinary."],
    },
    reminders: {
      steps: ["Use the filter buttons to see one kind of reminder.", "Click an item to open the contract it is about.", "Fix the cause (collect, top up the deposit, enter the reading) — the reminder disappears by itself."],
    },
    occupancy: {
      steps: ["Pick a date to see leased space on that day.", "Compare Building and Open land separately.", "Change a unit's type on its property page if it is in the wrong group."],
    },
    users: {
      steps: ["**Add user**: choose a role and the properties they may see.", "Switch download / print on only for people who need it.", "Reset a forgotten password from the server's control panel (option 5).", "Passwords need 10+ characters with letters and numbers. Resetting a password or deactivating a user signs them out everywhere."],
    },
    audit: {
      steps: ["Filter by person, action or date.", "Press + on a record to see all its changes and any reason given.", "Export CSV downloads every record that matches the filters.", "The log is permanent — entries can't be edited or deleted."],
    },
    billingRuns: {
      steps: ["Check the latest night succeeded; open anything marked partial or failed.", "**Run billing now** creates due bills without waiting for 03:00.", "A contract only joins the run after Catch up billing."],
    },
    backups: {
      steps: [
        "**Run backup now** before any risky change.",
        "Press the pin icon to make a backup **Permanent** (never deleted, not counted in the 30).",
        "Use the pencil icon to add a note, for example why you took it.",
        "Restoring is done from the server (`sudo lcm`, option 6).",
      ],
    },
    guide: {
      steps: ["Type a word in the search box to find it anywhere.", "Use **Quick start for…** to see what to do first for your role.", "Follow the chapters in order for a full lease lifecycle."],
    },
  },
  zh: {
    dashboard: {
      steps: [
        "先看**已逾期**：展开租户所在行，查看每笔未付账单，然后跟进租户。",
        "收到款项时：点合同编号 →「收款」→「录入收款」。",
        "留意「需要录入计量读数」，到合同的「用量记录」页签录入。",
        "黄色和蓝色提示框会列出押金不足和尚未开启自动出账的合同。",
      ],
    },
    "properties.list": {
      steps: ["管理员：点**新增物业**，填写名称和地址。", "点击某一行进入物业，添加它的单元。", "打开**显示已归档**可查看已归档的物业；仍有草稿或生效中合同占用其单元的物业不能归档。"],
    },
    "properties.detail": {
      steps: ["用**新增单元**添加每个可出租的空间（名称、类型、可出租面积）。", "不再出租的单元请停用，不要删除。", "在**文件**页签上传产权证、许可证和平面图。"],
    },
    "parties.list": {
      steps: [
        "**新增当事人**：选择公司或个人，并填写联系方式。",
        "管理员：在当事人的受保护区域记录证件号/执照号。",
        "已用于合同的当事人不能删除——请归档。",
        "点击列表中的合同编号可直接打开该合同。",
      ],
    },
    "contracts.list": {
      steps: [
        "**新增合同**（管理员/经理）会创建草稿；填写各页签后由管理员生效。",
        "用筛选查看某个租户或出租方的合同；点**清除筛选**取消。",
        "红色标签表示有逾期款——点击该行查看是哪些账单。",
        "管理员可归档**已到期或已终止**的合同（需款项结清、押金已处理）；打开**显示已归档**可查看。",
        "**导出CSV**可下载列表。",
      ],
    },
    "contracts.detail": {
      steps: [
        "草稿：填写「单元」「计价」「优惠/减免」「押金」「文件」，然后由管理员点**生效**。",
        "生效后：条款只能通过「变更」修改。",
        "在「账单」查看已出的账单，在「尚未出账」查看即将出的账单。",
        "在「收款」登记收到的款项。",
        "点击**生效**时，系统会先检查草稿，并列出需要先处理的问题（没有单元或费用、费率重叠、押金没有金额……）。",
      ],
    },
    "contracts.detail.units": {
      steps: ["**新增单元**：选择单元并填写合同面积。", "稍后才加入的单元请设置它自己的起始日期。", "生效后新增单元需通过变更。", "面积必须大于 0 且不超过该单元的可出租面积；同一单元不能在同一时间出现在两份草稿/生效中合同上。"],
    },
    "contracts.detail.pricing": {
      steps: ["为每项循环性费用（租金、管理费、电费……）**新增计价项**。", "选择计算方式和费率基准（每月、每平方米每月……）。", "阶梯租金：按时间添加多行费率。", "按面积计费的费用，只关联适用的单元。"],
    },
    "contracts.detail.concessions": {
      steps: ["**新增减免**：填写日期范围和折扣（100% = 免费）。", "可指定某项费用，留空则适用于所有费用。", "补账之前，请先录入过去的免租期。"],
    },
    "contracts.detail.deposit": {
      steps: [
        "**设置押金条款**：固定金额，或「3 个月租金」这类公式（需人工核对）。",
        "收到押金时：**登记交易** → 类型选「收取押金」。",
        "管理员：退还、扣除或转抵租金，均需填写原因。",
        "橙色标签/圆点 = 押金不足。",
      ],
    },
    "contracts.detail.statement": {
      steps: ["用日历选择月份。", "核对：期初余额 + 本期账单 − 收款 = 期末余额。", "未核销余额单独列出。"],
    },
    "contracts.detail.receipts": {
      steps: [
        "**录入收款**：日期、金额和方式——自动核销到最早的未付账单。",
        "**批量录入收款**一次录入多笔历史收款，按日期顺序处理。",
        "**核销**可以之后把剩余余额用到某笔账单上。",
        "保存后的 24 小时内，录入者本人（或管理员）可用**铅笔**按钮更正这笔收款。",
        "管理员：**冲销**录错的收款（需填写原因）。",
        "同一份合同上，一个银行流水号只能使用一次；收款日期不能晚于今天。",
      ],
    },
    "contracts.detail.usage": {
      steps: ["**读数表格录入**：为每项计量费用逐月填写用量，然后保存。", "**录入用量**可单独添加一条读数——**上个月**/**本月**按钮可快速填入服务起止日期，计量单位会自动预填（电费 kWh，水费 m³）。", "读数出账后，24 小时内（且其账单还没有收款）仍可更正——保存会重新出账。", "一条读数对应一个完整的自然月——抄表网格会自动帮你按整月填写。"],
    },
    "contracts.detail.charges": {
      steps: [
        "管理员：**补账**会先预览，确认后生成自租约开始以来的全部账单，并开启自动出账。",
        "**生成账单**手动生成某个月的账单（按季度/按年的合同需要）。",
        "管理员：**作废**有误的账单（需填写原因）。",
        "此页签上的红点表示有逾期款。",
      ],
    },
    "contracts.detail.upcoming": {
      title: "尚未出账",
      body: "按该合同条款预测的、系统将要生成的账单，涵盖到下个月底之前到期的款项，并列出金额和到期日。这些款项目前尚未产生欠款——账单要到期日才会生成。尚未开启自动出账的合同也会显示即将到期的部分；其尚未出账的历史账单请在「账单」页签用「补账」处理。",
      tips: [
        "金额是预测值：如果到期日前费率有变化（例如经批准的变更），金额会随之变化。",
        "计量类费用（电费、水费）要录入当月读数后才会出现；缺少的读数列在页面顶部。",
        "按季度/按年的合同无法在此预测，需在「账单」页签手动生成。",
      ],
      steps: ["查看合计和到期日，了解接下来该收什么。", "录入缺少的读数，相应费用才会出现。", "如果未开启自动出账，请管理员使用「补账」。"],
    },
    "contracts.detail.amendments": {
      steps: ["**发起变更**：选择要改什么、生效日期和原因。", "附上已签署的补充协议——这是必须的。", "提交后由管理员批准或驳回（管理员自己发起的会立即批准）。", "批准后会生成合同的新版本。", "要修改生效中合同的到期日或滞纳金规则，请选择**到期日与滞纳金规则**。"],
    },
    "contracts.detail.documents": {
      steps: ["**上传文件**：选择类型，以及普通或敏感。", "生效前必须先上传**已签署的租赁合同**。", "敏感文件（身份证复印件）只有管理员能打开。", "支持 PDF、图片、Word 和 Excel，单个不超过 50 MB。需要让看不到证件的同事使用时，请上传遮盖后的普通版本。"],
    },
    reminders: {
      steps: ["用筛选按钮只看某一类提醒。", "点击某条提醒可打开对应的合同。", "解决原因（收款、补足押金、录入读数）后，提醒会自动消失。"],
    },
    occupancy: {
      steps: ["选择日期，查看当天的出租情况。", "楼宇和空地分开比较。", "如果某个单元的类型归错了，请到其物业页面修改。"],
    },
    users: {
      steps: ["**新增用户**：选择角色和可查看的物业。", "只对确实需要的人开启下载/打印。", "忘记密码请在服务器控制面板中重置（选项 5）。", "密码至少 10 位，含字母和数字；重置密码或停用用户会让其在所有设备上退出登录。"],
    },
    audit: {
      steps: ["按人员、操作或日期筛选。", "点击记录上的 + 查看全部变更和填写的原因。", "“导出CSV”会下载符合筛选条件的全部记录。", "日志是永久的——记录无法编辑或删除。"],
    },
    billingRuns: {
      steps: ["确认最近一晚成功；点开标为部分失败或失败的记录。", "**立即运行出账**可不等到 03:00 就生成已到期的账单。", "合同要先「补账」才会加入每晚的运行。"],
    },
    backups: {
      steps: ["做重大改动前先**立即备份**。", "点图钉图标把备份设为**永久**（不会被删除，也不占 30 份名额）。", "点铅笔图标添加备注，例如备份原因。", "恢复需在服务器上操作（`sudo lcm`，选项 6）。"],
    },
    guide: {
      steps: ["在搜索框输入词语，可在全文中查找。", "用**快速上手**查看您的角色最先该做什么。", "按章节顺序阅读，可了解租约的完整周期。"],
    },
  },
};
