
(() => {
  "use strict";

  const DATA_KEY = "avalaPayTrackerData";
  const THEME_KEY = "avalaPayTrackerTheme";
  const $ = id => document.getElementById(id);

  let batches = [];
  let updatedAt = null;
  let scanStatus = "waiting";

  function money(value) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD"
    }).format(value || 0);
  }

  function localDate(value) {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return null;
    }

    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);

    return date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
      ? date
      : null;
  }

  function dayAge(batch) {
    const delivered = localDate(batch.deliveredDate);
    if (!delivered) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    delivered.setHours(0, 0, 0, 0);

    return Math.floor((today - delivered) / 86400000);
  }

  function group(days) {
    if (days <= 7) return "7";
    if (days <= 14) return "14";
    if (days <= 21) return "21";
    if (days <= 30) return "30";
    return "over30";
  }

  function groupLabel(days) {
    if (days <= 7) return "0–7 days";
    if (days <= 14) return "8–14 days";
    if (days <= 21) return "15–21 days";
    if (days <= 30) return "22–30 days";
    return "Over 30 days";
  }

  function dateLabel(value) {
    const date = localDate(value);

    return date
      ? date.toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric"
        })
      : "—";
  }

  function paymentStatus(batch) {
    const due = localDate(batch.payByDate);

    if (!due) {
      return { label: "Due date unavailable", className: "due" };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const remaining = Math.round((due - today) / 86400000);

    if (remaining < 0) {
      return {
        label: `Overdue ${Math.abs(remaining)} days`,
        className: "overdue"
      };
    }

    if (remaining === 0) {
      return { label: "Due today", className: "due" };
    }

    return {
      label: `${remaining} days left`,
      className: "upcoming"
    };
  }

  function totals() {
    const result = {
      "7": { amount: 0, count: 0 },
      "14": { amount: 0, count: 0 },
      "21": { amount: 0, count: 0 },
      "30": { amount: 0, count: 0 },
      over30: { amount: 0, count: 0 },
      grand: { amount: 0, count: 0 }
    };

    for (const batch of batches) {
      const age = dayAge(batch);

      // Future delivery dates and invalid dates should
      // not be silently counted as zero-day batches.
      if (age === null || age < 0) continue;

      const key = group(age);
      const amount = Number(batch.amount) || 0;

      result[key].amount += amount;
      result[key].count++;

      result.grand.amount += amount;
      result.grand.count++;
    }

    return result;
  }

  function renderSummary() {
    const t = totals();

    $("grandTotal").textContent = money(t.grand.amount);
    $("batchCount").textContent =
      `${t.grand.count} ${t.grand.count === 1 ? "batch" : "batches"}`;

    for (const key of ["7", "14", "21", "30", "over30"]) {
      const suffix = key === "over30" ? "Over30" : key;

      $(`total${suffix}`).textContent = money(t[key].amount);
      $(`count${suffix}`).textContent =
        `${t[key].count} ${t[key].count === 1 ? "batch" : "batches"}`;
    }
  }

  function addCell(row, value, className) {
    const cell = document.createElement("td");
    cell.textContent = value ?? "";

    if (className) cell.className = className;

    row.appendChild(cell);
    return cell;
  }

  function addPill(cell, label, className) {
    const pill = document.createElement("span");
    pill.className = `pill ${className}`;
    pill.textContent = label;
    cell.appendChild(pill);
  }

  function renderTable() {
    const body = $("batchRows");
    body.replaceChildren();

    const search = $("searchInput").value.trim().toLowerCase();
    const filter = $("ageFilter").value;

    const visible = batches.filter(batch => {
      const age = dayAge(batch);

      if (age === null || age < 0) return false;

      return batch.batch.toLowerCase().includes(search) &&
        (filter === "all" || group(age) === filter);
    });

    visible.sort((a, b) => dayAge(b) - dayAge(a));

    if (!visible.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");

      cell.colSpan = 7;
      cell.className = "empty";
      cell.textContent = scanStatus === "empty"
        ? "No upcoming batches detected. Confirm that the Upcoming Payments section is visible in Avala."
        : batches.length
          ? "No batches match the selected filters."
          : "Open Avala Payments in another tab, sign in, and wait for the scan.";

      row.appendChild(cell);
      body.appendChild(row);
    }

    for (const batch of visible) {
      const age = dayAge(batch);
      const row = document.createElement("tr");

      addCell(row, batch.batch);
      addCell(row, money(batch.amount));
      addCell(row, dateLabel(batch.completedDate));
      addCell(row, dateLabel(batch.deliveredDate));
      addCell(row, dateLabel(batch.payByDate));

      const ageCell = document.createElement("td");
      const ageClass = age <= 7 ? "fresh"
        : age <= 14 ? "week2"
        : age <= 21 ? "week3"
        : age <= 30 ? "month" : "old";

      addPill(ageCell, `${age} days · ${groupLabel(age)}`, ageClass);
      row.appendChild(ageCell);

      const status = paymentStatus(batch);
      const statusCell = document.createElement("td");
      addPill(statusCell, status.label, status.className);
      row.appendChild(statusCell);

      body.appendChild(row);
    }

    $("showingCount").textContent =
      `Showing ${visible.length} of ${batches.length} detected batches`;
  }

  function renderConnection() {
    const el = $("connection");

    if (updatedAt) {
      el.textContent = scanStatus === "empty"
        ? "Scan complete · No batches found"
        : "Avala data received";

      $("lastUpdated").textContent =
        new Date(updatedAt).toLocaleString();
    } else {
      el.textContent = "Waiting for Avala";
      $("lastUpdated").textContent = "Waiting for first scan";
    }
  }

  function render() {
    renderSummary();
    renderTable();
    renderConnection();
  }

  async function loadData() {
    try {
      const saved = await chrome.storage.local.get(DATA_KEY);
      const payload = saved[DATA_KEY];

      if (!payload) {
        batches = [];
        updatedAt = null;
        scanStatus = "waiting";
      } else {
        batches = Array.isArray(payload.batches)
          ? payload.batches
          : [];

        updatedAt = payload.updatedAt || null;
        scanStatus = payload.scanStatus || "success";
      }

      render();
    } catch (error) {
      console.error("Unable to load tracker data:", error);
      $("connection").textContent = "Unable to load data";
    }
  }

  function spreadsheetExport() {
    const t = totals();

    const rows = [
      ["AVALA PAY TRACKER"],
      ["Exported", new Date().toLocaleString()],
      ["Source", "Upcoming Payments"],
      [],
      [
        "Batch ID",
        "Amount USD",
        "Completed Date",
        "Delivered Date",
        "Pay By",
        "Days Since Delivery",
        "Age Group",
        "Payment Status"
      ]
    ];

    for (const batch of batches) {
      const age = dayAge(batch);

      if (age === null || age < 0) continue;

      rows.push([
        batch.batch,
        Number(batch.amount).toFixed(2),
        batch.completedDate || "",
        batch.deliveredDate || "",
        batch.payByDate || "",
        age,
        groupLabel(age),
        paymentStatus(batch).label
      ]);
    }

    rows.push([]);
    rows.push(["TOTALS BY DELIVERY AGE"]);
    rows.push(["Age Group", "Batch Count", "Total USD"]);

    for (const [label, key] of [
      ["0–7 days", "7"],
      ["8–14 days", "14"],
      ["15–21 days", "21"],
      ["22–30 days", "30"],
      ["Over 30 days", "over30"]
    ]) {
      rows.push([
        label,
        t[key].count,
        t[key].amount.toFixed(2)
      ]);
    }

    rows.push([
      "GRAND TOTAL",
      t.grand.count,
      t.grand.amount.toFixed(2)
    ]);

    return rows.map(row =>
      row.map(value =>
        String(value ?? "")
          .replace(/\t/g, " ")
          .replace(/\r?\n/g, " ")
      ).join("\t")
    ).join("\n");
  }

  async function exportToSheets() {
    const content = spreadsheetExport();

    try {
      await navigator.clipboard.writeText(content);
    } catch {
      const area = document.createElement("textarea");
      area.value = content;
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();

      const copied = document.execCommand("copy");
      area.remove();

      if (!copied) {
        alert("Copy failed. Please try again.");
        return;
      }
    }

    await chrome.tabs.create({
      url: "https://sheets.new",
      active: true
    });

    alert(
      "Your batch data is copied. In Google Sheets, select cell A1 and press Ctrl + V."
    );
  }

  async function loadTheme() {
    const saved = await chrome.storage.local.get(THEME_KEY);

    if (saved[THEME_KEY] === "light") {
      document.body.classList.add("light");
    }
  }

  async function toggleTheme() {
    document.body.classList.toggle("light");

    const theme = document.body.classList.contains("light")
      ? "light"
      : "dark";

    await chrome.storage.local.set({ [THEME_KEY]: theme });
  }

  $("searchInput").addEventListener("input", renderTable);
  $("ageFilter").addEventListener("change", renderTable);
  $("refreshBtn").addEventListener("click", loadData);
  $("themeBtn").addEventListener("click", toggleTheme);
  $("exportBtn").addEventListener("click", exportToSheets);
  $("printBtn").addEventListener("click", () => window.print());

  $("closeBtn").addEventListener("click", async () => {
    const tab = await chrome.tabs.getCurrent();

    if (tab?.id != null) {
      await chrome.tabs.remove(tab.id);
    }
  });

  $("minimizeBtn").addEventListener("click", async () => {
    const win = await chrome.windows.getCurrent();

    if (win.id != null) {
      await chrome.windows.update(win.id, {
        state: "minimized"
      });
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[DATA_KEY]) {
      loadData();
    }
  });

  loadTheme();
  loadData();

  // Refresh age calculations as the day changes.
  setInterval(render, 60000);
})();
