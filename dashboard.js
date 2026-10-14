(() => {
  "use strict";

  const DATA_KEY = "avalaPayTrackerData";
  const THEME_KEY = "avalaPayTrackerTheme";

  let allBatches = [];
  let lastScan = null;

  const $ = id => document.getElementById(id);

  const money = value =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD"
    }).format(value || 0);

  function parseLocalDate(value) {
    if (!value) return null;

    const parts = value.split("-").map(Number);

    if (parts.length !== 3 || parts.some(Number.isNaN)) {
      return null;
    }

    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function dayDifference(from, to) {
    const a = new Date(from);
    const b = new Date(to);

    a.setHours(0, 0, 0, 0);
    b.setHours(0, 0, 0, 0);

    return Math.floor((b - a) / 86400000);
  }

  function ageFor(batch) {
    const delivered = parseLocalDate(batch.deliveredDate);

    if (!delivered) return null;

    return Math.max(0, dayDifference(delivered, new Date()));
  }

  function groupFor(days) {
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

  function ageClass(days) {
    if (days <= 7) return "fresh";
    if (days <= 14) return "week2";
    if (days <= 21) return "week3";
    if (days <= 30) return "month";
    return "old";
  }

  function dateLabel(value) {
    const date = parseLocalDate(value);

    if (!date) return "—";

    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    });
  }

  function paymentStatus(batch) {
    if (!batch.payByDate) {
      return {
        label: "Not available",
        className: "due"
      };
    }

    const dueDate = parseLocalDate(batch.payByDate);
    const today = new Date();

    today.setHours(0, 0, 0, 0);

    if (!dueDate) {
      return {
        label: "Not available",
        className: "due"
      };
    }

    const remaining = dayDifference(today, dueDate);

    if (remaining < 0) {
      return {
        label: `Overdue ${Math.abs(remaining)}d`,
        className: "overdue"
      };
    }

    if (remaining === 0) {
      return {
        label: "Due today",
        className: "due"
      };
    }

    return {
      label: `${remaining} days left`,
      className: "upcoming"
    };
  }

  function calculateTotals(batches) {
    const totals = {
      "7": { amount: 0, count: 0 },
      "14": { amount: 0, count: 0 },
      "21": { amount: 0, count: 0 },
      "30": { amount: 0, count: 0 },
      "over30": { amount: 0, count: 0 },
      grand: { amount: 0, count: 0 }
    };

    for (const batch of batches) {
      const age = ageFor(batch);

      if (age === null) continue;

      const group = groupFor(age);

      totals[group].amount += Number(batch.amount) || 0;
      totals[group].count += 1;

      totals.grand.amount += Number(batch.amount) || 0;
      totals.grand.count += 1;
    }

    return totals;
  }

  function setText(id, value) {
    $(id).textContent = value;
  }

  function renderSummary() {
    const totals = calculateTotals(allBatches);

    setText("grandTotal", money(totals.grand.amount));
    setText("batchCount", totals.grand.count);

    for (const key of ["7", "14", "21", "30", "over30"]) {
      const suffix = key === "over30" ? "Over30" : key;

      setText(
        `total${suffix}`,
        money(totals[key].amount)
      );

      setText(
        `count${suffix}`,
        `${totals[key].count} ${
          totals[key].count === 1 ? "batch" : "batches"
        }`
      );
    }
  }

  function getFilteredBatches() {
    const search = $("searchInput").value
      .trim()
      .toLowerCase();

    const filter = $("ageFilter").value;

    return allBatches.filter(batch => {
      const age = ageFor(batch);

      if (age === null) return false;

      const matchesSearch =
        batch.batch.toLowerCase().includes(search);

      const matchesAge =
        filter === "all" || groupFor(age) === filter;

      return matchesSearch && matchesAge;
    });
  }

  function renderTable() {
    const tbody = $("batchRows");
    const batches = getFilteredBatches();

    tbody.replaceChildren();

    if (!batches.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");

      cell.colSpan = 7;
      cell.className = "empty";
      cell.textContent = allBatches.length
        ? "No batches match your search or age filter."
        : "No upcoming batches found. Open Avala Payments and make sure the Upcoming Payments section is visible.";

      row.appendChild(cell);
      tbody.appendChild(row);

      setText("showingCount", "Showing 0 batches");
      return;
    }

    batches.sort((a, b) => {
      return ageFor(b) - ageFor(a);
    });

    for (const batch of batches) {
      const age = ageFor(batch);
      const status = paymentStatus(batch);
      const row = document.createElement("tr");

      const values = [
        batch.batch,
        money(batch.amount),
        dateLabel(batch.completedDate),
        dateLabel(batch.deliveredDate),
        dateLabel(batch.payByDate),
        `${age} days`
      ];

      values.forEach((value, index) => {
        const cell = document.createElement("td");

        if (index === 0) {
          cell.className = "batch-name";
        }

        if (index === 1) {
          cell.className = "amount";
        }

        if (index === 5) {
          const pill = document.createElement("span");

          pill.className = `age-pill ${ageClass(age)}`;
          pill.textContent = `${value} · ${groupLabel(age)}`;

          cell.appendChild(pill);
        } else {
          cell.textContent = value || "—";
        }

        row.appendChild(cell);
      });

      const statusCell = document.createElement("td");
      const statusPill = document.createElement("span");

      statusPill.className =
        `payment-pill ${status.className}`;

      statusPill.textContent = status.label;

      statusCell.appendChild(statusPill);
      row.appendChild(statusCell);
      tbody.appendChild(row);
    }

    setText(
      "showingCount",
      `Showing ${batches.length} of ${allBatches.length} batches`
    );
  }

  function renderConnection() {
    const connection = $("connection");

    if (lastScan) {
      connection.classList.add("connected");
      connection.innerHTML =
        '<span class="status-dot"></span> Data received';
    } else {
      connection.classList.remove("connected");
      connection.innerHTML =
        '<span class="status-dot"></span> Waiting for data';
    }

    if (lastScan) {
      const date = new Date(lastScan);

      setText(
        "lastUpdated",
        date.toLocaleString()
      );
    } else {
      setText("lastUpdated", "Waiting for Avala");
    }
  }

  function render() {
    renderSummary();
    renderTable();
    renderConnection();
  }

  async function loadData() {
    const stored = await chrome.storage.local.get(DATA_KEY);
    const payload = stored[DATA_KEY];

    if (!payload || !Array.isArray(payload.batches)) {
      allBatches = [];
      lastScan = null;
      render();
      return;
    }

    allBatches = payload.batches;
    lastScan = payload.updatedAt || null;

    render();
  }

  function buildSpreadsheetText() {
    const totals = calculateTotals(allBatches);

    const rows = [
      ["AVALA PAY TRACKER"],
      ["Exported at", new Date().toLocaleString()],
      [],
      [
        "Batch ID",
        "Amount (USD)",
        "Completed Date",
        "Delivered Date",
        "Pay By",
        "Days Since Delivery",
        "Age Group",
        "Payment Status"
      ]
    ];

    for (const batch of allBatches) {
      const age = ageFor(batch);
      const status = paymentStatus(batch);

      rows.push([
        batch.batch,
        Number(batch.amount).toFixed(2),
        batch.completedDate || "",
        batch.deliveredDate || "",
        batch.payByDate || "",
        age === null ? "" : age,
        age === null ? "" : groupLabel(age),
        status.label
      ]);
    }

    rows.push([]);
    rows.push(["TOTALS BY DELIVERY AGE"]);
    rows.push(["Age Group", "Batch Count", "Total Amount (USD)"]);

    const groups = [
      ["0–7 days", "7"],
      ["8–14 days", "14"],
      ["15–21 days", "21"],
      ["22–30 days", "30"],
      ["Over 30 days", "over30"]
    ];

    for (const [label, key] of groups) {
      rows.push([
        label,
        totals[key].count,
        totals[key].amount.toFixed(2)
      ]);
    }

    rows.push([
      "GRAND TOTAL",
      totals.grand.count,
      totals.grand.amount.toFixed(2)
    ]);

    return rows
      .map(row =>
        row.map(value =>
          String(value ?? "")
            .replace(/\t/g, " ")
            .replace(/\r?\n/g, " ")
        ).join("\t")
      )
      .join("\n");
  }

  async function exportToSheets() {
    const text = buildSpreadsheetText();

    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      const textarea = document.createElement("textarea");

      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";

      document.body.appendChild(textarea);
      textarea.select();

      const copied = document.execCommand("copy");
      textarea.remove();

      if (!copied) {
        alert("Could not copy the spreadsheet data. Please try again.");
        return;
      }
    }

    window.open(
      "https://sheets.new",
      "_blank",
      "noopener"
    );

    alert(
      "Batch data copied. In Google Sheets, click cell A1 and press Ctrl + V."
    );
  }

  async function toggleTheme() {
    document.body.classList.toggle("light");

    const theme = document.body.classList.contains("light")
      ? "light"
      : "dark";

    await chrome.storage.local.set({
      [THEME_KEY]: theme
    });
  }

  async function loadTheme() {
    const saved = await chrome.storage.local.get(THEME_KEY);

    if (saved[THEME_KEY] === "light") {
      document.body.classList.add("light");
    }
  }

  $("searchInput").addEventListener("input", renderTable);
  $("ageFilter").addEventListener("change", renderTable);
  $("refreshBtn").addEventListener("click", loadData);
  $("exportBtn").addEventListener("click", exportToSheets);
  $("themeBtn").addEventListener("click", toggleTheme);

  $("closeBtn").addEventListener("click", async () => {
    const tab = await chrome.tabs.getCurrent();

    if (tab && tab.id) {
      await chrome.tabs.remove(tab.id);
    }
  });

  $("minimizeBtn").addEventListener("click", async () => {
    const win = await chrome.windows.getCurrent();

    if (win.id) {
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

  // Update the displayed age when a new day begins,
  // even if the stored batch data has not changed.
  setInterval(render, 60000);
})();
