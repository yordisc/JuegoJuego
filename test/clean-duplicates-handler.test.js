const assert = require("node:assert");
const path = require("node:path");
const { test } = require("node:test");
const Module = require("node:module");

const targetPath = path.join(__dirname, "..", "netlify", "functions", "clean-duplicates.js");

function resolveFromTarget(request) {
  return require.resolve(request, { paths: [path.dirname(targetPath)] });
}

async function withMockedLoad(mockedModules, run) {
  const originalLoad = Module._load;

  Module._load = function patchedLoad(request, parent, isMain) {
    const resolved = Module._resolveFilename(request, parent, isMain);
    if (Object.prototype.hasOwnProperty.call(mockedModules, resolved)) {
      return mockedModules[resolved];
    }

    return originalLoad.apply(this, arguments);
  };

  try {
    delete require.cache[targetPath];
    const loaded = require(targetPath);
    return await run(loaded);
  } finally {
    Module._load = originalLoad;
    delete require.cache[targetPath];
  }
}

test("clean-duplicates handler: usa publicados cuando tracked esta incompleto", async () => {
  const cleanInputs = [];
  const savedPublished = [];
  const savedTracked = [];

  const androidPublished = [
    {
      id: "android.game",
      messageId: 10,
      publishedAt: 1000,
      title: "Android Game Old",
      titleMatch: "android game old",
      chatId: "@android_channel",
    },
    {
      id: "android.game",
      messageId: 11,
      publishedAt: 2000,
      title: "Android Game New",
      titleMatch: "android game new",
      chatId: "@android_channel",
    },
  ];

  const mockedMemory = {
    getPublishedGamesList: async (_store, platform) =>
      platform === "android" ? androidPublished : [],
    savePublishedGamesList: async (_store, list, platform) => {
      savedPublished.push({ platform, list: [...list] });
    },
  };

  const mockedService = {
    cleanDuplicates: async (list) => {
      cleanInputs.push({ size: list.length, list: list.map((item) => ({ ...item })) });

      if (list.length > 1) {
        const newest = list.reduce((best, curr) =>
          Number(curr.publishedAt) >= Number(best.publishedAt) ? curr : best
        );
        list.length = 0;
        list.push(newest);

        return {
          success: true,
          duplicatesFound: 1,
          messagesDeleted: 1,
          removedMessageIds: [10],
          errors: [],
        };
      }

      return {
        success: true,
        duplicatesFound: 0,
        messagesDeleted: 0,
        removedMessageIds: [],
        errors: [],
      };
    },
  };

  const mockedMaintenance = {
    readTrackedMessages: async () => [],
    saveTrackedMessages: async (_store, list) => {
      savedTracked.push([...list]);
    },
  };

  const mockedBlobs = {
    createBlobStoreFromEnv: () => ({ get: async () => null, setJSON: async () => {} }),
    getBlobCredentialReport: () => ({ siteID: "test-site", token: "test-token", issues: [] }),
  };

  const mocks = {
    [resolveFromTarget("../../utils/memory")]: mockedMemory,
    [resolveFromTarget("../../services/clean-duplicates")]: mockedService,
    [resolveFromTarget("../../services/manual-maintenance")]: mockedMaintenance,
    [resolveFromTarget("../../utils/netlify-blobs")]: mockedBlobs,
  };

  await withMockedLoad(mocks, async ({ handler }) => {
    const response = await handler({}, {});
    assert.strictEqual(response.statusCode, 200);
  });

  assert.strictEqual(cleanInputs.length, 2);
  assert.strictEqual(cleanInputs[0].size, 2);
  assert.strictEqual(cleanInputs[0].list.some((x) => x.messageId === 10), true);
  assert.strictEqual(cleanInputs[0].list.some((x) => x.messageId === 11), true);

  assert.strictEqual(savedTracked.length, 1);
  assert.strictEqual(savedTracked[0].length, 1);
  assert.strictEqual(savedTracked[0][0].messageId, 11);

  const savedAndroid = savedPublished.find((entry) => entry.platform === "android");
  assert.ok(savedAndroid);
  assert.strictEqual(savedAndroid.list.length, 1);
  assert.strictEqual(savedAndroid.list[0].messageId, 11);
  assert.strictEqual(savedAndroid.list[0].title, "Android Game New");
  assert.strictEqual(savedAndroid.list[0].titleMatch, "android game new");
  assert.strictEqual(savedAndroid.list[0].chatId, "@android_channel");
  assert.strictEqual(savedAndroid.list[0].platform, "android");
});

test("clean-duplicates handler: deduplica PC usando publicados cuando tracked no trae datos", async () => {
  const cleanInputs = [];
  const savedPublished = [];
  const savedTracked = [];

  const pcPublished = [
    {
      id: "pc.game",
      messageId: 20,
      publishedAt: 1000,
      title: "PC Game Old",
      titleMatch: "pc game old",
      chatId: "@pc_channel",
    },
    {
      id: "pc.game",
      messageId: 21,
      publishedAt: 2000,
      title: "PC Game New",
      titleMatch: "pc game new",
      chatId: "@pc_channel",
    },
  ];

  const mockedMemory = {
    getPublishedGamesList: async (_store, platform) =>
      platform === "pc" ? pcPublished : [],
    savePublishedGamesList: async (_store, list, platform) => {
      savedPublished.push({ platform, list: [...list] });
    },
  };

  const mockedService = {
    cleanDuplicates: async (list) => {
      cleanInputs.push({ size: list.length, list: list.map((item) => ({ ...item })) });

      if (list.length > 1) {
        const newest = list.reduce((best, curr) =>
          Number(curr.publishedAt) >= Number(best.publishedAt) ? curr : best
        );
        list.length = 0;
        list.push(newest);

        return {
          success: true,
          duplicatesFound: 1,
          messagesDeleted: 1,
          removedMessageIds: [20],
          errors: [],
        };
      }

      return {
        success: true,
        duplicatesFound: 0,
        messagesDeleted: 0,
        removedMessageIds: [],
        errors: [],
      };
    },
  };

  const mockedMaintenance = {
    readTrackedMessages: async () => [],
    saveTrackedMessages: async (_store, list) => {
      savedTracked.push([...list]);
    },
  };

  const mockedBlobs = {
    createBlobStoreFromEnv: () => ({ get: async () => null, setJSON: async () => {} }),
    getBlobCredentialReport: () => ({ siteID: "test-site", token: "test-token", issues: [] }),
  };

  const mocks = {
    [resolveFromTarget("../../utils/memory")]: mockedMemory,
    [resolveFromTarget("../../services/clean-duplicates")]: mockedService,
    [resolveFromTarget("../../services/manual-maintenance")]: mockedMaintenance,
    [resolveFromTarget("../../utils/netlify-blobs")]: mockedBlobs,
  };

  await withMockedLoad(mocks, async ({ handler }) => {
    const response = await handler({}, {});
    assert.strictEqual(response.statusCode, 200);
  });

  assert.strictEqual(cleanInputs.length, 2);
  assert.strictEqual(cleanInputs[0].size, 0);
  assert.strictEqual(cleanInputs[1].size, 2);
  assert.strictEqual(cleanInputs[1].list.some((x) => x.messageId === 20), true);
  assert.strictEqual(cleanInputs[1].list.some((x) => x.messageId === 21), true);

  assert.strictEqual(savedTracked.length, 1);
  assert.strictEqual(savedTracked[0].length, 1);
  assert.strictEqual(savedTracked[0][0].messageId, 21);

  const savedPc = savedPublished.find((entry) => entry.platform === "pc");
  assert.ok(savedPc);
  assert.strictEqual(savedPc.list.length, 1);
  assert.strictEqual(savedPc.list[0].messageId, 21);
  assert.strictEqual(savedPc.list[0].title, "PC Game New");
  assert.strictEqual(savedPc.list[0].titleMatch, "pc game new");
  assert.strictEqual(savedPc.list[0].chatId, "@pc_channel");
  assert.strictEqual(savedPc.list[0].platform, "pc");
});

test("clean-duplicates handler: procesa Android y PC en la misma corrida sin mezclar plataformas", async () => {
  const cleanInputs = [];
  const savedPublished = [];
  const savedTracked = [];

  const androidPublished = [
    {
      id: "android.same",
      messageId: 30,
      publishedAt: 1000,
      title: "Android Same Old",
      titleMatch: "android same old",
      chatId: "@android",
    },
    {
      id: "android.same",
      messageId: 31,
      publishedAt: 2000,
      title: "Android Same New",
      titleMatch: "android same new",
      chatId: "@android",
    },
  ];
  const pcPublished = [
    {
      id: "pc.same",
      messageId: 40,
      publishedAt: 1000,
      title: "PC Same Old",
      titleMatch: "pc same old",
      chatId: "@pc",
    },
    {
      id: "pc.same",
      messageId: 41,
      publishedAt: 2000,
      title: "PC Same New",
      titleMatch: "pc same new",
      chatId: "@pc",
    },
  ];

  const mockedMemory = {
    getPublishedGamesList: async (_store, platform) => {
      if (platform === "android") return androidPublished;
      if (platform === "pc") return pcPublished;
      return [];
    },
    savePublishedGamesList: async (_store, list, platform) => {
      savedPublished.push({ platform, list: [...list] });
    },
  };

  const mockedService = {
    cleanDuplicates: async (list) => {
      cleanInputs.push({ size: list.length, list: list.map((item) => ({ ...item })) });

      if (list.length > 1) {
        const newest = list.reduce((best, curr) =>
          Number(curr.publishedAt) >= Number(best.publishedAt) ? curr : best
        );
        const removed = list
          .filter((item) => item.messageId !== newest.messageId)
          .map((item) => item.messageId);
        list.length = 0;
        list.push(newest);

        return {
          success: true,
          duplicatesFound: 1,
          messagesDeleted: removed.length,
          removedMessageIds: removed,
          errors: [],
        };
      }

      return {
        success: true,
        duplicatesFound: 0,
        messagesDeleted: 0,
        removedMessageIds: [],
        errors: [],
      };
    },
  };

  const mockedMaintenance = {
    readTrackedMessages: async () => [],
    saveTrackedMessages: async (_store, list) => {
      savedTracked.push([...list]);
    },
  };

  const mockedBlobs = {
    createBlobStoreFromEnv: () => ({ get: async () => null, setJSON: async () => {} }),
    getBlobCredentialReport: () => ({ siteID: "test-site", token: "test-token", issues: [] }),
  };

  const mocks = {
    [resolveFromTarget("../../utils/memory")]: mockedMemory,
    [resolveFromTarget("../../services/clean-duplicates")]: mockedService,
    [resolveFromTarget("../../services/manual-maintenance")]: mockedMaintenance,
    [resolveFromTarget("../../utils/netlify-blobs")]: mockedBlobs,
  };

  await withMockedLoad(mocks, async ({ handler }) => {
    const response = await handler({}, {});
    assert.strictEqual(response.statusCode, 200);
  });

  assert.strictEqual(cleanInputs.length, 2);
  assert.strictEqual(cleanInputs[0].size, 2);
  assert.strictEqual(cleanInputs[0].list.every((x) => x.platform === "android"), true);
  assert.strictEqual(cleanInputs[1].size, 2);
  assert.strictEqual(cleanInputs[1].list.every((x) => x.platform === "pc"), true);

  assert.strictEqual(savedTracked.length, 1);
  assert.strictEqual(savedTracked[0].length, 2);
  assert.strictEqual(savedTracked[0].some((x) => x.messageId === 31), true);
  assert.strictEqual(savedTracked[0].some((x) => x.messageId === 41), true);

  const savedAndroid = savedPublished.find((entry) => entry.platform === "android");
  const savedPc = savedPublished.find((entry) => entry.platform === "pc");
  assert.ok(savedAndroid);
  assert.ok(savedPc);
  assert.strictEqual(savedAndroid.list.length, 1);
  assert.strictEqual(savedAndroid.list[0].messageId, 31);
  assert.strictEqual(savedAndroid.list[0].titleMatch, "android same new");
  assert.strictEqual(savedAndroid.list[0].platform, "android");
  assert.strictEqual(savedPc.list.length, 1);
  assert.strictEqual(savedPc.list[0].messageId, 41);
  assert.strictEqual(savedPc.list[0].titleMatch, "pc same new");
  assert.strictEqual(savedPc.list[0].platform, "pc");
});
