/**
 * Golf stats: submit score to Supabase, fetch leaderboard + percentile + total + average.
 * Depends: supabase-config.js, Supabase CDN (createClient).
 */
(function () {
  const STORAGE_KEY = 'betterseason_anonymous_id';

  function getClient() {
    if (!window.supabase || !window.supabase.createClient) return null;
    const cfg = window.SupabaseConfig;
    if (!cfg || !cfg.url || !cfg.anonKey) return null;
    return window.supabase.createClient(cfg.url, cfg.anonKey);
  }

  function getOrCreateAnonymousId() {
    try {
      let id = localStorage.getItem(STORAGE_KEY);
      if (!id) {
        id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'x-' + Math.random().toString(36).slice(2);
        localStorage.setItem(STORAGE_KEY, id);
      }
      return id;
    } catch (e) {
      return 'x-' + Math.random().toString(36).slice(2);
    }
  }

  /**
   * Submit a score. Returns { ok: true } or { ok: false, error }.
   */
  function submitScore(puzzleId, sport, mode, score, higherIsBetter) {
    const supabase = getClient();
    if (!supabase) return Promise.resolve({ ok: false, error: 'Supabase not configured' });

    const anonymousId = getOrCreateAnonymousId();
    const initials = (window.PlayerInitials && window.PlayerInitials.getInitials) ? window.PlayerInitials.getInitials() : null;
    const payload = {
      puzzle_id: puzzleId,
      sport: sport,
      mode: mode,
      score: score,
      higher_is_better: higherIsBetter,
      anonymous_id: anonymousId
    };
    if (initials) payload.initials = initials;
    return supabase
      .from('scores')
      .insert(payload)
      .select()
      .single()
      .then(function () { return { ok: true, anonymousId: anonymousId }; })
      .catch(function (err) {
        if (err && err.code === '23505') return { ok: true, anonymousId: anonymousId }; // unique violation = already submitted
        return { ok: false, error: err && err.message ? err.message : 'Submit failed' };
      });
  }

  /**
   * Fetch all scores for a puzzle (for percentile, leaderboard, total, average).
   * higherIsBetter: false for golf.
   */
  function fetchScoresForPuzzle(puzzleId, higherIsBetter) {
    const supabase = getClient();
    if (!supabase) return Promise.resolve(null);

    return supabase
      .from('scores')
      .select('score, anonymous_id, initials')
      .eq('puzzle_id', puzzleId)
      .order('score', { ascending: !higherIsBetter })
      .then(function (res) {
        if (res.error) return null;
        return res.data || [];
      });
  }

  /**
   * Compute stats from rows. higherIsBetter: false for golf.
   */
  function computeStats(rows, myScore, myAnonymousId, higherIsBetter) {
    if (!rows || rows.length === 0) {
      return { totalPlayers: 0, averageScore: null, percentile: null, leaderboard: [], myRank: null };
    }
    const totalPlayers = rows.length;
    const sum = rows.reduce(function (a, r) { return a + r.score; }, 0);
    const averageScore = sum / totalPlayers;

    // Leaderboard: already sorted by score (asc for golf, desc for main app)
    const leaderboard = rows.slice(0, 10).map(function (r, i) {
      return { rank: i + 1, score: r.score, anonymousId: r.anonymous_id, initials: r.initials || null, isYou: r.anonymous_id === myAnonymousId };
    });

    // Percentile: for golf (lower better), % of people who did worse (score > myScore)
    let worseCount;
    if (higherIsBetter) {
      worseCount = rows.filter(function (r) { return r.score < myScore; }).length;
    } else {
      worseCount = rows.filter(function (r) { return r.score > myScore; }).length;
    }
    const percentile = totalPlayers > 0 ? Math.round((worseCount / totalPlayers) * 100) : null;

    const myRow = rows.find(function (r) { return r.anonymous_id === myAnonymousId; });
    const myRank = myRow ? rows.indexOf(myRow) + 1 : null;

    return {
      totalPlayers: totalPlayers,
      averageScore: averageScore,
      percentile: percentile,
      leaderboard: leaderboard,
      myRank: myRank
    };
  }

  /**
   * Submit score then fetch and return stats. Callback(stats) with stats object or null if failed.
   */
  function submitAndFetchStats(puzzleId, sport, mode, score, higherIsBetter, callback) {
    submitScore(puzzleId, sport, mode, score, higherIsBetter).then(function (result) {
      if (!result.ok) {
        if (typeof callback === 'function') callback(null);
        return;
      }
      fetchScoresForPuzzle(puzzleId, higherIsBetter).then(function (rows) {
        const stats = rows ? computeStats(rows, score, result.anonymousId, higherIsBetter) : null;
        if (typeof callback === 'function') callback(stats);
      });
    });
  }

  /**
   * Fetch leaderboard/stats only (no submit). Use when re-opening results modal so we don't duplicate submit.
   * Callback(stats) with stats object or null if failed.
   */
  function fetchStatsOnly(puzzleId, score, higherIsBetter, callback) {
    const anonymousId = getOrCreateAnonymousId();
    fetchScoresForPuzzle(puzzleId, higherIsBetter).then(function (rows) {
      const stats = rows ? computeStats(rows, score, anonymousId, higherIsBetter) : null;
      if (typeof callback === 'function') callback(stats);
    });
  }

  window.GolfStats = {
    getOrCreateAnonymousId: getOrCreateAnonymousId,
    submitScore: submitScore,
    fetchScoresForPuzzle: fetchScoresForPuzzle,
    submitAndFetchStats: submitAndFetchStats,
    fetchStatsOnly: fetchStatsOnly,
    computeStats: computeStats
  };
})();
