(function () {
  const STORAGE_KEY = "wedding-expenses-state-v1";
  const TABLE_NAME = "wedding_expenses";
  const baseExpenses = [];
  const supabaseConfig = window.SUPABASE_CONFIG || {};
  const supabaseClient = createSupabaseClient();

  const state = {
    expenses: [],
    search: "",
    category: "all",
    status: "all",
    sort: "remainingDesc",
    session: null,
    user: null,
    remoteReady: false,
    syncing: false,
  };

  const money = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  const number = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const els = {
    appShell: document.querySelector(".app-shell"),
    authPanel: document.querySelector("#authPanel"),
    authTitle: document.querySelector("#authTitle"),
    authStatus: document.querySelector("#authStatus"),
    authForm: document.querySelector("#authForm"),
    authEmail: document.querySelector("#authEmail"),
    authPassword: document.querySelector("#authPassword"),
    signUpButton: document.querySelector("#signUpButton"),
    signOutButton: document.querySelector("#signOutButton"),
    totalBudget: document.querySelector("#totalBudget"),
    totalPaid: document.querySelector("#totalPaid"),
    totalRemaining: document.querySelector("#totalRemaining"),
    paidPercent: document.querySelector("#paidPercent"),
    overallProgress: document.querySelector("#overallProgress"),
    itemCount: document.querySelector("#itemCount"),
    paidCount: document.querySelector("#paidCount"),
    pendingCount: document.querySelector("#pendingCount"),
    expensesBody: document.querySelector("#expensesBody"),
    emptyState: document.querySelector("#emptyState"),
    searchInput: document.querySelector("#searchInput"),
    categoryFilter: document.querySelector("#categoryFilter"),
    sortSelect: document.querySelector("#sortSelect"),
    statusTabs: document.querySelector(".status-tabs"),
    categoryList: document.querySelector("#categoryList"),
    pendingList: document.querySelector("#pendingList"),
    insightStrip: document.querySelector("#insightStrip"),
    saveState: document.querySelector("#saveState"),
    toast: document.querySelector("#toast"),
    dialog: document.querySelector("#expenseDialog"),
    form: document.querySelector("#expenseForm"),
    dialogTitle: document.querySelector("#dialogTitle"),
    expenseId: document.querySelector("#expenseId"),
    categoryInput: document.querySelector("#categoryInput"),
    itemInput: document.querySelector("#itemInput"),
    totalInput: document.querySelector("#totalInput"),
    paidInput: document.querySelector("#paidInput"),
    dueInput: document.querySelector("#dueInput"),
    notesInput: document.querySelector("#notesInput"),
    categoryOptions: document.querySelector("#categoryOptions"),
    paymentChart: document.querySelector("#paymentChart"),
  };

  bindEvents();
  render();
  void initializeRemote();

  function createSupabaseClient() {
    if (!supabaseConfig.url || !supabaseConfig.key) return null;
    if (window.supabase && window.supabase.createClient) {
      return window.supabase.createClient(supabaseConfig.url, supabaseConfig.key, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
        },
      });
    }

    return createFetchSupabaseClient(supabaseConfig.url, supabaseConfig.key);
  }

  function createFetchSupabaseClient(url, key) {
    const sessionKey = `sb-${new URL(url).hostname}-auth-token`;
    let currentSession = readStoredSession();

    return {
      auth: {
        async getSession() {
          await refreshSessionIfNeeded();
          return { data: { session: currentSession }, error: null };
        },
        async signInWithPassword(credentials) {
          const result = await authRequest("/auth/v1/token?grant_type=password", {
            method: "POST",
            body: credentials,
          });
          if (result.error) return { data: { session: null, user: null }, error: result.error };
          setSession(normalizeSession(result.data));
          return { data: { session: currentSession, user: currentSession.user }, error: null };
        },
        async signUp(credentials) {
          const result = await authRequest("/auth/v1/signup", {
            method: "POST",
            body: credentials,
          });
          if (result.error) return { data: { session: null, user: null }, error: result.error };
          if (result.data && result.data.access_token) {
            setSession(normalizeSession(result.data));
            return { data: { session: currentSession, user: currentSession.user }, error: null };
          }
          return { data: { session: null, user: result.data && result.data.user }, error: null };
        },
        async signOut() {
          if (currentSession && currentSession.access_token) {
            await fetch(`${url}/auth/v1/logout`, {
              method: "POST",
              headers: {
                apikey: key,
                Authorization: `Bearer ${currentSession.access_token}`,
              },
            }).catch(() => null);
          }
          setSession(null);
          return { error: null };
        },
        onAuthStateChange() {
          return {
            data: {
              subscription: {
                unsubscribe() {},
              },
            },
          };
        },
      },
      from(tableName) {
        return createQueryBuilder(tableName);
      },
    };

    function readStoredSession() {
      try {
        const parsed = JSON.parse(localStorage.getItem(sessionKey) || "null");
        return parsed && parsed.access_token ? parsed : null;
      } catch (_error) {
        return null;
      }
    }

    function setSession(session) {
      currentSession = session;
      if (session) {
        localStorage.setItem(sessionKey, JSON.stringify(session));
      } else {
        localStorage.removeItem(sessionKey);
      }
    }

    function normalizeSession(data) {
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        token_type: data.token_type || "bearer",
        expires_in: data.expires_in || 3600,
        expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
        user: data.user,
      };
    }

    async function refreshSessionIfNeeded() {
      if (!currentSession || !currentSession.refresh_token) return;
      const now = Math.floor(Date.now() / 1000);
      if (currentSession.expires_at && currentSession.expires_at > now + 60) return;

      const result = await authRequest("/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        body: { refresh_token: currentSession.refresh_token },
      });

      if (result.error || !result.data || !result.data.access_token) {
        setSession(null);
        return;
      }

      setSession(normalizeSession(result.data));
    }

    async function authRequest(path, options) {
      const response = await fetch(`${url}${path}`, {
        method: options.method,
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(options.body || {}),
      });
      return parseResponse(response);
    }

    async function restHeaders(hasBody) {
      await refreshSessionIfNeeded();
      const headers = {
        apikey: key,
        Authorization: `Bearer ${currentSession ? currentSession.access_token : key}`,
      };
      if (hasBody) headers["Content-Type"] = "application/json";
      return headers;
    }

    function createQueryBuilder(tableName) {
      const query = {
        method: "GET",
        selectColumns: "*",
        filters: [],
        orders: [],
        body: null,
        singleResult: false,
        prefer: "",
      };

      const builder = {
        select(columns) {
          query.selectColumns = columns || "*";
          return builder;
        },
        order(column, options = {}) {
          query.orders.push(`${column}.${options.ascending === false ? "desc" : "asc"}`);
          return builder;
        },
        eq(column, value) {
          query.filters.push([column, `eq.${value}`]);
          return builder;
        },
        in(column, values) {
          query.filters.push([column, `in.(${values.join(",")})`]);
          return builder;
        },
        insert(payload) {
          query.method = "POST";
          query.body = payload;
          query.prefer = "return=representation";
          return builder;
        },
        update(payload) {
          query.method = "PATCH";
          query.body = payload;
          query.prefer = "return=representation";
          return builder;
        },
        delete() {
          query.method = "DELETE";
          return builder;
        },
        single() {
          query.singleResult = true;
          return builder;
        },
        then(resolve, reject) {
          return executeQuery().then(resolve, reject);
        },
        catch(reject) {
          return executeQuery().catch(reject);
        },
      };

      async function executeQuery() {
        const params = new URLSearchParams();
        params.set("select", query.selectColumns);
        query.filters.forEach(([column, value]) => params.append(column, value));
        if (query.orders.length) params.set("order", query.orders.join(","));

        const headers = await restHeaders(Boolean(query.body));
        if (query.prefer) headers.Prefer = query.prefer;

        const response = await fetch(`${url}/rest/v1/${tableName}?${params.toString()}`, {
          method: query.method,
          headers,
          body: query.body ? JSON.stringify(query.body) : undefined,
        });
        const result = await parseResponse(response);
        if (result.error || !query.singleResult) return result;

        return {
          data: Array.isArray(result.data) ? result.data[0] || null : result.data,
          error: null,
        };
      }

      return builder;
    }

    async function parseResponse(response) {
      const text = await response.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch (_error) {
          data = text;
        }
      }

      if (!response.ok) {
        const message =
          (data && (data.msg || data.message || data.error_description || data.error)) ||
          `Erro ${response.status}`;
        return { data: null, error: { message, status: response.status } };
      }

      return { data, error: null };
    }
  }

  function bindEvents() {
    document.querySelector("#addExpense").addEventListener("click", () => openDialog());
    document.querySelector("#closeDialog").addEventListener("click", closeDialog);
    document.querySelector("#cancelDialog").addEventListener("click", closeDialog);
    document.querySelector("#exportCsv").addEventListener("click", exportCsv);
    document.querySelector("#resetData").addEventListener("click", resetData);

    els.authForm.addEventListener("submit", signIn);
    els.signUpButton.addEventListener("click", signUp);
    els.signOutButton.addEventListener("click", signOut);

    els.searchInput.addEventListener("input", (event) => {
      state.search = event.target.value.trim().toLowerCase();
      render();
    });

    els.categoryFilter.addEventListener("change", (event) => {
      state.category = event.target.value;
      render();
    });

    els.sortSelect.addEventListener("change", (event) => {
      state.sort = event.target.value;
      render();
    });

    els.statusTabs.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-status]");
      if (!button) return;
      state.status = button.dataset.status;
      els.statusTabs.querySelectorAll("button").forEach((tab) => {
        tab.classList.toggle("active", tab === button);
      });
      render();
    });

    els.form.addEventListener("submit", saveExpense);
  }

  async function initializeRemote() {
    renderAuth();
    if (!supabaseClient) {
      setSaveLabel("Modo local");
      return;
    }

    state.syncing = true;
    renderAuth();

    const { data, error } = await supabaseClient.auth.getSession();
    if (error) {
      state.syncing = false;
      showToast("N\u00e3o foi poss\u00edvel verificar o login.");
      renderAuth();
      return;
    }

    await applySession(data.session || null);
    supabaseClient.auth.onAuthStateChange((_event, session) => {
      void applySession(session || null);
    });
  }

  async function applySession(session) {
    state.session = session;
    state.user = session ? session.user : null;

    if (!state.user) {
      state.remoteReady = false;
      state.syncing = false;
      state.expenses = [];
      setSaveLabel("Entre para ver seus dados");
      render();
      return;
    }

    await loadRemoteExpenses();
  }

  async function loadRemoteExpenses() {
    if (!supabaseClient || !state.user) return;

    state.syncing = true;
    setSaveLabel("Sincronizando...");
    renderAuth();

    const { data, error } = await supabaseClient
      .from(TABLE_NAME)
      .select("id, category, item, total, paid, due, notes, sort_order")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      state.syncing = false;
      state.remoteReady = false;
      showToast(messageFromError(error, "N\u00e3o foi poss\u00edvel carregar do Supabase."));
      setSaveLabel("Modo local");
      render();
      return;
    }

    if (!data || data.length === 0) {
      state.expenses = [];
      state.remoteReady = true;
      state.syncing = false;
      setSaveLabel("Sincronizado no Supabase");
      render();
      return;
    }

    state.expenses = data.map(fromDbRow);
    state.remoteReady = true;
    state.syncing = false;
    setSaveLabel("Sincronizado no Supabase");
    render();
  }

  async function seedRemoteExpenses() {
    const payload = state.expenses.map((expense, index) => toDbPayload(expense, index));
    const { data, error } = await supabaseClient
      .from(TABLE_NAME)
      .insert(payload)
      .select("id, category, item, total, paid, due, notes, sort_order");

    state.syncing = false;

    if (error) {
      state.remoteReady = false;
      showToast(messageFromError(error, "N\u00e3o foi poss\u00edvel enviar os dados iniciais."));
      setSaveLabel("Modo local");
      render();
      return;
    }

    state.expenses = data.map(fromDbRow);
    state.remoteReady = true;
    cacheLocalExpenses();
    setSaveLabel("Sincronizado no Supabase");
    showToast("Dados iniciais enviados ao Supabase.");
    render();
  }

  async function signIn(event) {
    event.preventDefault();
    if (!supabaseClient) {
      showToast("Supabase indispon\u00edvel neste carregamento.");
      return;
    }

    const email = els.authEmail.value.trim();
    const password = els.authPassword.value;
    if (!email || !password) return;

    state.syncing = true;
    renderAuth();

    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      state.syncing = false;
      renderAuth();
      showToast(messageFromError(error, "N\u00e3o foi poss\u00edvel entrar."));
      return;
    }

    showToast("Conectado ao Supabase.");
    await applySession(data.session || null);
  }

  async function signUp() {
    if (!supabaseClient) {
      showToast("Supabase indispon\u00edvel neste carregamento.");
      return;
    }

    const email = els.authEmail.value.trim();
    const password = els.authPassword.value;
    if (!email || !password) {
      showToast("Preencha e-mail e senha.");
      return;
    }

    state.syncing = true;
    renderAuth();

    const { data, error } = await supabaseClient.auth.signUp({ email, password });
    state.syncing = false;

    if (error) {
      renderAuth();
      showToast(messageFromError(error, "N\u00e3o foi poss\u00edvel criar o acesso."));
      return;
    }

    if (data.session) {
      showToast("Acesso criado.");
      await applySession(data.session);
      return;
    }

    renderAuth("Confira seu e-mail para confirmar o acesso.");
    showToast("Acesso criado. Confirme pelo e-mail antes de entrar.");
  }

  async function signOut() {
    if (!supabaseClient) return;
    await supabaseClient.auth.signOut();
    await applySession(null);
    showToast("Voc\u00ea saiu do Supabase.");
  }

  function loadLocalExpenses() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (Array.isArray(stored) && stored.length) {
        return stored.map(sanitizeExpense);
      }
    } catch (error) {
      console.warn("Could not read saved expenses", error);
    }
    return baseExpenses.map(sanitizeExpense);
  }

  function cacheLocalExpenses() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.expenses));
  }

  function setSaveLabel(message) {
    els.saveState.textContent = message;
  }

  function sanitizeExpense(expense) {
    return {
      id: expense.id || makeId(),
      category: String(expense.category || "Sem categoria").trim(),
      item: String(expense.item || "Novo gasto").trim(),
      total: toAmount(expense.total),
      paid: toAmount(expense.paid),
      due: String(expense.due || "").trim(),
      notes: String(expense.notes || "").trim(),
      sortOrder: Number.isFinite(Number(expense.sortOrder)) ? Number(expense.sortOrder) : 0,
    };
  }

  function fromDbRow(row) {
    return sanitizeExpense({
      id: row.id,
      category: row.category,
      item: row.item,
      total: row.total,
      paid: row.paid,
      due: row.due,
      notes: row.notes,
      sortOrder: row.sort_order,
    });
  }

  function toDbPayload(expense, index) {
    return {
      category: expense.category,
      item: expense.item,
      total: expense.total,
      paid: Math.min(expense.paid, expense.total),
      due: expense.due || "",
      notes: expense.notes || "",
      sort_order: Number.isFinite(Number(expense.sortOrder)) ? Number(expense.sortOrder) : index,
    };
  }

  function toAmount(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.round(parsed * 100) / 100;
  }

  function remaining(expense) {
    return Math.max(toAmount(expense.total) - toAmount(expense.paid), 0);
  }

  function paidRatio(expense) {
    return expense.total > 0 ? Math.min(expense.paid / expense.total, 1) : 0;
  }

  function statusOf(expense) {
    if (remaining(expense) <= 0.009) return "Pago";
    if (expense.paid <= 0.009) return "A pagar";
    return "Parcial";
  }

  function summarize(expenses = state.expenses) {
    const total = expenses.reduce((sum, expense) => sum + expense.total, 0);
    const paid = expenses.reduce((sum, expense) => sum + Math.min(expense.paid, expense.total), 0);
    const open = Math.max(total - paid, 0);
    const paidItems = expenses.filter((expense) => statusOf(expense) === "Pago").length;
    return {
      total,
      paid,
      open,
      percent: total > 0 ? paid / total : 0,
      paidItems,
      pendingItems: expenses.length - paidItems,
      count: expenses.length,
    };
  }

  function filteredExpenses() {
    const query = state.search;
    return state.expenses
      .filter((expense) => {
        const matchesQuery =
          !query ||
          [expense.item, expense.category, expense.due, expense.notes]
            .join(" ")
            .toLowerCase()
            .includes(query);
        const matchesCategory = state.category === "all" || expense.category === state.category;
        const matchesStatus = state.status === "all" || statusOf(expense) === state.status;
        return matchesQuery && matchesCategory && matchesStatus;
      })
      .sort(sorter(state.sort));
  }

  function sorter(mode) {
    const byText = (a, b, getter) => getter(a).localeCompare(getter(b), "pt-BR", { sensitivity: "base" });
    const sorters = {
      remainingDesc: (a, b) => remaining(b) - remaining(a),
      totalDesc: (a, b) => b.total - a.total,
      categoryAsc: (a, b) => byText(a, b, (expense) => `${expense.category} ${expense.item}`),
      nameAsc: (a, b) => byText(a, b, (expense) => expense.item),
      paidPercentDesc: (a, b) => paidRatio(b) - paidRatio(a),
    };
    return sorters[mode] || sorters.remainingDesc;
  }

  function render() {
    renderAuth();
    renderFilters();
    renderSummary();
    renderInsights();
    renderTable();
    renderCategories();
    renderPending();
    drawChart();
  }

  function renderAuth(customMessage) {
    els.appShell.classList.toggle("is-locked", !state.user);

    if (!supabaseClient) {
      els.authPanel.classList.remove("is-synced");
      els.authTitle.textContent = "Acesso indispon\u00edvel";
      els.authStatus.textContent = "N\u00e3o foi poss\u00edvel conectar ao Supabase";
      els.authForm.hidden = true;
      els.signOutButton.hidden = true;
      return;
    }

    if (state.user) {
      els.authPanel.classList.add("is-synced");
      els.authTitle.textContent = "Supabase conectado";
      els.authStatus.textContent = state.syncing ? "Sincronizando..." : state.user.email || "Usu\u00e1rio conectado";
      els.authForm.hidden = true;
      els.signOutButton.hidden = false;
      return;
    }

    els.authPanel.classList.remove("is-synced");
    els.authTitle.textContent = "Entrar para ver seus dados";
    els.authStatus.textContent = customMessage || (state.syncing ? "Conectando..." : "Privado por login");
    els.authForm.hidden = false;
    els.signOutButton.hidden = true;
  }

  function renderFilters() {
    const current = els.categoryFilter.value || state.category;
    const categories = getCategories();
    els.categoryFilter.innerHTML = [
      `<option value="all">Todas as categorias</option>`,
      ...categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`),
    ].join("");
    els.categoryFilter.value = categories.includes(current) ? current : "all";
    state.category = els.categoryFilter.value;

    els.categoryOptions.innerHTML = categories
      .map((category) => `<option value="${escapeHtml(category)}"></option>`)
      .join("");
  }

  function renderSummary() {
    const totals = summarize();
    els.totalBudget.textContent = money.format(totals.total);
    els.totalPaid.textContent = money.format(totals.paid);
    els.totalRemaining.textContent = money.format(totals.open);
    els.paidPercent.textContent = `${Math.round(totals.percent * 100)}%`;
    els.overallProgress.style.width = `${Math.round(totals.percent * 100)}%`;
    els.itemCount.textContent = `${totals.count} ${totals.count === 1 ? "item" : "itens"}`;
    els.paidCount.textContent = `${totals.paidItems} ${totals.paidItems === 1 ? "quitado" : "quitados"}`;
    els.pendingCount.textContent = `${totals.pendingItems} ${totals.pendingItems === 1 ? "pendente" : "pendentes"}`;
  }

  function renderInsights() {
    const totals = summarize();
    const categories = categorySummaries();
    const largestOpen = [...state.expenses].sort((a, b) => remaining(b) - remaining(a))[0];
    const largestCategory = categories[0];
    const averageOpen = totals.pendingItems ? totals.open / totals.pendingItems : 0;

    const insights = [
      {
        label: "Maior pend\u00eancia",
        title: largestOpen ? largestOpen.item : "Sem pend\u00eancias",
        detail: largestOpen ? money.format(remaining(largestOpen)) : money.format(0),
      },
      {
        label: "Categoria cr\u00edtica",
        title: largestCategory ? largestCategory.category : "Sem categorias",
        detail: largestCategory ? money.format(largestCategory.open) : money.format(0),
      },
      {
        label: "M\u00e9dia pendente",
        title: money.format(averageOpen),
        detail: `${totals.pendingItems} ${totals.pendingItems === 1 ? "saldo aberto" : "saldos abertos"}`,
      },
    ];

    els.insightStrip.innerHTML = insights
      .map(
        (insight) => `
          <article class="insight">
            <div>
              <small>${escapeHtml(insight.label)}</small>
              <strong>${escapeHtml(insight.title)}</strong>
              <span>${escapeHtml(insight.detail)}</span>
            </div>
          </article>
        `,
      )
      .join("");
  }

  function renderTable() {
    const expenses = filteredExpenses();
    els.emptyState.hidden = expenses.length !== 0;
    els.expensesBody.innerHTML = expenses
      .map((expense) => {
        const status = statusOf(expense);
        const note = expense.notes ? `<small>${escapeHtml(expense.notes)}</small>` : "";
        return `
          <tr>
            <td class="item-cell">
              <strong>${escapeHtml(expense.item)}</strong>
              ${note}
            </td>
            <td>${escapeHtml(expense.category)}</td>
            <td class="money">${money.format(expense.total)}</td>
            <td class="money">${money.format(expense.paid)}</td>
            <td class="money">${money.format(remaining(expense))}</td>
            <td>${statusBadge(status)}</td>
            <td>${expense.due ? escapeHtml(expense.due) : "&mdash;"}</td>
            <td>
              <div class="row-actions">
                <button class="action-button" type="button" title="Marcar como pago" aria-label="Marcar ${escapeHtml(expense.item)} como pago" data-action="pay" data-id="${expense.id}" ${status === "Pago" ? "disabled" : ""}>&#10003;</button>
                <button class="action-button" type="button" title="Editar" aria-label="Editar ${escapeHtml(expense.item)}" data-action="edit" data-id="${expense.id}">&#9998;</button>
                <button class="action-button danger" type="button" title="Remover" aria-label="Remover ${escapeHtml(expense.item)}" data-action="delete" data-id="${expense.id}">&times;</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");

    els.expensesBody.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", handleRowAction);
    });
  }

  function statusBadge(status) {
    const classes = {
      Pago: "status-paid",
      Parcial: "status-partial",
      "A pagar": "status-open",
    };
    return `<span class="status-pill ${classes[status]}">${status}</span>`;
  }

  function renderCategories() {
    const summaries = categorySummaries();
    const maxOpen = Math.max(...summaries.map((category) => category.open), 1);
    els.categoryList.innerHTML = summaries
      .map((category) => {
        const width = Math.round((category.open / maxOpen) * 100);
        return `
          <button class="category-row" type="button" data-category="${escapeHtml(category.category)}">
            <strong>${escapeHtml(category.category)}</strong>
            <span>${money.format(category.open)}</span>
            <span>${category.count} ${category.count === 1 ? "item" : "itens"}</span>
            <span>${Math.round(category.percent * 100)}% pago</span>
            <div class="category-bar" aria-hidden="true"><i style="width:${width}%"></i></div>
          </button>
        `;
      })
      .join("");

    els.categoryList.querySelectorAll(".category-row").forEach((button) => {
      button.addEventListener("click", () => {
        state.category = button.dataset.category;
        render();
      });
    });
  }

  function renderPending() {
    const pending = [...state.expenses]
      .filter((expense) => remaining(expense) > 0)
      .sort((a, b) => remaining(b) - remaining(a))
      .slice(0, 5);

    els.pendingList.innerHTML = pending.length
      ? pending
          .map(
            (expense) => `
              <article class="pending-item">
                <strong>${escapeHtml(expense.item)}</strong>
                <span>${escapeHtml(expense.category)}</span>
                <span>${money.format(remaining(expense))}${expense.due ? ` &middot; ${escapeHtml(expense.due)}` : ""}</span>
              </article>
            `,
          )
          .join("")
      : `<article class="pending-item"><strong>Tudo quitado</strong><span>${money.format(0)}</span></article>`;
  }

  function categorySummaries() {
    const map = new Map();
    state.expenses.forEach((expense) => {
      const current = map.get(expense.category) || {
        category: expense.category,
        total: 0,
        paid: 0,
        open: 0,
        count: 0,
      };
      current.total += expense.total;
      current.paid += Math.min(expense.paid, expense.total);
      current.open += remaining(expense);
      current.count += 1;
      map.set(expense.category, current);
    });

    return [...map.values()]
      .map((category) => ({
        ...category,
        percent: category.total > 0 ? category.paid / category.total : 0,
      }))
      .sort((a, b) => b.open - a.open);
  }

  function getCategories() {
    return [...new Set(state.expenses.map((expense) => expense.category))].sort((a, b) =>
      a.localeCompare(b, "pt-BR", { sensitivity: "base" }),
    );
  }

  async function handleRowAction(event) {
    const button = event.currentTarget;
    const expense = state.expenses.find((item) => item.id === button.dataset.id);
    if (!expense) return;

    if (button.dataset.action === "pay") {
      await markAsPaid(expense);
    }

    if (button.dataset.action === "edit") {
      openDialog(expense);
    }

    if (button.dataset.action === "delete") {
      await deleteExpense(expense);
    }
  }

  async function markAsPaid(expense) {
    const next = { ...expense, paid: expense.total };
    if (isRemoteMode()) {
      const saved = await updateRemoteExpense(next);
      if (!saved) return;
      replaceExpense(saved);
      setSaveLabel("Sincronizado no Supabase");
    } else {
      replaceExpense(next);
      setSaveLabel("Salvo localmente");
    }

    showToast("Lan\u00e7amento marcado como pago.");
    render();
  }

  async function deleteExpense(expense) {
    const ok = window.confirm(`Remover "${expense.item}"?`);
    if (!ok) return;

    if (isRemoteMode()) {
      const { error } = await supabaseClient.from(TABLE_NAME).delete().eq("id", expense.id);
      if (error) {
        showToast(messageFromError(error, "N\u00e3o foi poss\u00edvel remover."));
        return;
      }
    }

    state.expenses = state.expenses.filter((item) => item.id !== expense.id);
    setSaveLabel(isRemoteMode() ? "Sincronizado no Supabase" : "Salvo localmente");
    showToast("Lan\u00e7amento removido.");
    render();
  }

  function openDialog(expense) {
    const editing = Boolean(expense);
    els.dialogTitle.textContent = editing ? "Editar gasto" : "Novo gasto";
    els.expenseId.value = editing ? expense.id : "";
    els.categoryInput.value = editing ? expense.category : "";
    els.itemInput.value = editing ? expense.item : "";
    els.totalInput.value = editing ? String(expense.total) : "";
    els.paidInput.value = editing ? String(expense.paid) : "0";
    els.dueInput.value = editing ? expense.due : "";
    els.notesInput.value = editing ? expense.notes : "";
    els.dialog.showModal();
    window.setTimeout(() => els.categoryInput.focus(), 0);
  }

  function closeDialog() {
    els.dialog.close();
    els.form.reset();
  }

  async function saveExpense(event) {
    event.preventDefault();
    const id = els.expenseId.value || makeId();
    const next = sanitizeExpense({
      id,
      category: els.categoryInput.value,
      item: els.itemInput.value,
      total: els.totalInput.value,
      paid: Math.min(toAmount(els.paidInput.value), toAmount(els.totalInput.value)),
      due: els.dueInput.value,
      notes: els.notesInput.value,
      sortOrder: 0,
    });

    const index = state.expenses.findIndex((expense) => expense.id === id);

    if (isRemoteMode()) {
      const saved = index >= 0 ? await updateRemoteExpense(next) : await insertRemoteExpense(next);
      if (!saved) return;
      if (index >= 0) {
        state.expenses.splice(index, 1, saved);
      } else {
        state.expenses.unshift(saved);
      }
      setSaveLabel("Sincronizado no Supabase");
    } else if (index >= 0) {
      state.expenses.splice(index, 1, next);
      setSaveLabel("Salvo localmente");
    } else {
      state.expenses.unshift(next);
      setSaveLabel("Salvo localmente");
    }

    closeDialog();
    showToast("Lan\u00e7amento salvo.");
    render();
  }

  async function insertRemoteExpense(expense) {
    const { data, error } = await supabaseClient
      .from(TABLE_NAME)
      .insert(toDbPayload(expense, 0))
      .select("id, category, item, total, paid, due, notes, sort_order")
      .single();

    if (error) {
      showToast(messageFromError(error, "N\u00e3o foi poss\u00edvel salvar."));
      return null;
    }

    return fromDbRow(data);
  }

  async function updateRemoteExpense(expense) {
    const { data, error } = await supabaseClient
      .from(TABLE_NAME)
      .update(toDbPayload(expense, expense.sortOrder || 0))
      .eq("id", expense.id)
      .select("id, category, item, total, paid, due, notes, sort_order")
      .single();

    if (error) {
      showToast(messageFromError(error, "N\u00e3o foi poss\u00edvel atualizar."));
      return null;
    }

    return fromDbRow(data);
  }

  async function resetData() {
    {
      if (!isRemoteMode()) {
        showToast("Entre para gerenciar seus dados.");
        return;
      }

      const ok = window.confirm("Apagar todos os seus gastos cadastrados?");
      if (!ok) return;

      const ids = state.expenses.map((expense) => expense.id);
      if (ids.length) {
        const { error: deleteError } = await supabaseClient.from(TABLE_NAME).delete().in("id", ids);
        if (deleteError) {
          showToast(messageFromError(deleteError, "Nao foi possivel limpar os dados."));
          return;
        }
      }

      state.expenses = [];
      setSaveLabel("Sincronizado no Supabase");
      state.search = "";
      state.category = "all";
      state.status = "all";
      state.sort = "remainingDesc";
      els.searchInput.value = "";
      els.sortSelect.value = "remainingDesc";
      els.statusTabs.querySelectorAll("button").forEach((tab) => {
        tab.classList.toggle("active", tab.dataset.status === "all");
      });
      showToast("Dados apagados.");
      render();
      return;
    }

    const ok = window.confirm("Restaurar os dados originais da planilha?");
    if (!ok) return;

    if (isRemoteMode()) {
      const ids = state.expenses.map((expense) => expense.id);
      if (ids.length) {
        const { error: deleteError } = await supabaseClient.from(TABLE_NAME).delete().in("id", ids);
        if (deleteError) {
          showToast(messageFromError(deleteError, "N\u00e3o foi poss\u00edvel restaurar."));
          return;
        }
      }

      const payload = baseExpenses.map((expense, index) => toDbPayload(sanitizeExpense(expense), index));
      const { data, error } = await supabaseClient
        .from(TABLE_NAME)
        .insert(payload)
        .select("id, category, item, total, paid, due, notes, sort_order");

      if (error) {
        showToast(messageFromError(error, "N\u00e3o foi poss\u00edvel restaurar."));
        return;
      }

      state.expenses = data.map(fromDbRow);
      setSaveLabel("Sincronizado no Supabase");
    } else {
      state.expenses = baseExpenses.map(sanitizeExpense);
      setSaveLabel("Salvo localmente");
    }

    state.search = "";
    state.category = "all";
    state.status = "all";
    state.sort = "remainingDesc";
    els.searchInput.value = "";
    els.sortSelect.value = "remainingDesc";
    els.statusTabs.querySelectorAll("button").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.status === "all");
    });
    showToast("Dados originais restaurados.");
    render();
  }

  function replaceExpense(next) {
    const index = state.expenses.findIndex((expense) => expense.id === next.id);
    if (index >= 0) {
      state.expenses.splice(index, 1, next);
    }
  }

  function isRemoteMode() {
    return Boolean(supabaseClient && state.user && state.remoteReady);
  }

  function exportCsv() {
    const headers = [
      "Categoria",
      "Item",
      "Valor Total",
      "Pago",
      "Restante",
      "Status",
      "Vencimento/Prazo",
      "Observa\u00e7\u00f5es",
      "% Pago",
    ];

    const rows = state.expenses.map((expense) => [
      expense.category,
      expense.item,
      decimalForCsv(expense.total),
      decimalForCsv(expense.paid),
      decimalForCsv(remaining(expense)),
      statusOf(expense),
      expense.due,
      expense.notes,
      decimalForCsv(paidRatio(expense) * 100),
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";"))
      .join("\n");

    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "gastos-casamento.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("CSV exportado.");
  }

  function decimalForCsv(value) {
    return number.format(value);
  }

  function drawChart() {
    const canvas = els.paymentChart;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const size = 240;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size, size);

    const totals = summarize();
    const center = size / 2;
    const radius = 92;
    const lineWidth = 26;
    const start = -Math.PI / 2;
    const paidAngle = start + Math.PI * 2 * totals.percent;

    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";

    ctx.beginPath();
    ctx.strokeStyle = "#ecdde2";
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.stroke();

    if (totals.percent > 0) {
      ctx.beginPath();
      ctx.strokeStyle = "#0f766e";
      ctx.arc(center, center, radius, start, paidAngle);
      ctx.stroke();
    }

    ctx.fillStyle = "#202124";
    ctx.font = "700 32px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${Math.round(totals.percent * 100)}%`, center, center - 6);
    ctx.fillStyle = "#647078";
    ctx.font = "700 13px Segoe UI, sans-serif";
    ctx.fillText("pago", center, center + 24);
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("show");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => els.toast.classList.remove("show"), 2300);
  }

  function messageFromError(error, fallback) {
    return error && error.message ? error.message : fallback;
  }

  function makeId() {
    if (window.crypto && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `expense-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
})();
