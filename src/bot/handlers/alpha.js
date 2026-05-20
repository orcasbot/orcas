const prisma = require('../../lib/prisma');
const logger = require('../../utils/logger');
const { extractContractAddresses } = require('../../services/ca-parser');

let orchestrator = null;

function setOrchestrator(orch) {
  orchestrator = orch;
}

async function handleAlphaMessage(callerUsername, groupUsername, messageText, bot) {
  try {
    // Normalize usernames (strip leading @, lowercase)
    const caller = callerUsername.replace(/^@/, '').toLowerCase();
    const group = groupUsername.replace(/^@/, '').toLowerCase();

    // Find all alpha caller subscriptions matching this caller + group
    const subscriptions = await prisma.alphaCaller.findMany({
      where: {
        callerUsername: caller,
        groupUsername: group,
      },
      include: { user: true },
    });

    if (!subscriptions.length) return;

    // Extract contract addresses from the message
    const addresses = extractContractAddresses(messageText);
    if (!addresses.length) return;

    // Take the first CA found
    const contractAddress = addresses[0];

    logger.info(`Alpha caller ${caller} posted CA ${contractAddress} in ${group}, ${subscriptions.length} subscriber(s) found`);

    // Execute auto-buy for each tracking user
    for (const sub of subscriptions) {
      try {
        if (!orchestrator) {
          logger.error('Orchestrator not initialized in alpha handler');
          return;
        }

        await orchestrator.executeBuy({
          userId: sub.userId,
          contractAddress,
          chain: 'base',
          amount: sub.buyAmount || null,
          source: 'alpha',
          callerUsername: caller,
          groupUsername: group,
        });

        logger.info(`Auto-buy executed for user ${sub.userId} on CA ${contractAddress}`);

        // Notify user via DM if bot instance available
        if (bot && sub.user?.chatId) {
          await bot.telegram.sendMessage(
            sub.user.chatId,
            `🟢 Alpha Buy Triggered\nCaller: @${caller}\nGroup: @${group}\nCA: ${contractAddress}`
          ).catch(err => logger.warn(`Failed to notify user ${sub.userId}: ${err.message}`));
        }
      } catch (err) {
        logger.error(`Auto-buy failed for user ${sub.userId} on CA ${contractAddress}: ${err.message}`);
      }
    }
  } catch (err) {
    logger.error(`handleAlphaMessage error: ${err.message}`);
  }
}

module.exports = { setOrchestrator, handleAlphaMessage };
