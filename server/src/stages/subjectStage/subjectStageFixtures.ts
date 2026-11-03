/**
 * SUBJECT STAGE planner fixtures (test support, pure data). Original scripts; no brand / language / copy from any reference.
 * `build` lays sentences end to end: [text, spokenSec, pauseAfterSec?].
 */
import type {StageSentence} from './planSubjectStage.ts';

type Row = [text: string, spokenSec: number, pauseAfterSec?: number];
export function build(rows: readonly Row[], t0 = 0.4): {sentences: StageSentence[]; durationSec: number} {
  let t = t0;
  const sentences: StageSentence[] = [];
  for (const [text, dur, pause] of rows) {
    sentences.push({start: Math.round(t * 1000) / 1000, end: Math.round((t + dur) * 1000) / 1000, text});
    t += dur + (pause ?? 0.25);
  }
  return {sentences, durationSec: Math.round((t + 0.4) * 1000) / 1000};
}

/** A cautionary talk about a fake donation page (every intent appears, one official statement). ~80 s. */
export const FIXTURE_ALERT = build([
  ['Imagine you open your phone right after a flood hit your town.', 4.2],
  ['Last year the same thing happened and everyone wanted to help.', 4.0],
  ['A page started circulating and it said "please send relief money to this personal account".', 5.2],
  ['The post said the money would go to the national relief fund.', 3.6],
  ['So I searched for it and the results were everywhere.', 3.8],
  ['Some links looked real, some websites copied the same headline, and many sources repeated it.', 5.4],
  ['The term for this is called phishing, and it works because people are in a hurry.', 5.0],
  ['Yes.', 1.6],
  ['Now the official statement from the ministry is clear about it.', 4.4],
  ['The final conclusion is that you should verify through official channels before sending any money.', 6.0],
  ['Never share your bank PIN, your OTP, or a password with a stranger online.', 5.0],
  ['Back in 2019 a similar scam took 40 percent of one village savings.', 5.2],
  ['Everyone I know searched the same terms and scrolled through the same pages.', 4.6],
  ['Because the reason it spreads is that people share before they check.', 4.6],
  ['Remember the first step is to pause and read the source.', 4.0],
]);

/** An explainer with mostly key terms and a couple of citations. ~62 s. */
export const FIXTURE_EXPLAINER = build([
  ['Here is what a contract clause actually means in plain words.', 4.2],
  ['The term indemnity is basically a promise to cover another party loss.', 4.6],
  ['The lawyer said "this clause protects the buyer from hidden costs and fees".', 5.0],
  ['For example, if a supplier delivers late, the penalty is defined in section 4.', 5.4],
  ['Second, check the termination notice period, which is usually 30 days.', 4.4],
  ['Then look at the governing law because it decides which court hears a dispute.', 5.2],
  ['Honestly most people skip this part and sign anyway.', 3.6],
  ['According to the report, nearly half of small businesses never read the fine print.', 5.4],
  ['Exactly.', 1.5],
  ['Finally, ask for a written summary of every change before you agree.', 4.4],
  ['That is the whole process.', 2.4],
]);

/** A long mixed talk (~150 s) used for the share-target check: the intents are spread like a real edit (context ~37 %, quoting ~17 %, search ~17 %, key terms / verdict / neutral ~26 %, one official). */
export const FIXTURE_LONG = build([
  ['Imagine a small town where the story started last spring.', 6.2],
  ['One post said "the market will double by next year, according to experts".', 6.2],
  ['The key idea is called compounding and it grows slowly at first.', 3.6],
  ['Back in 2020 the situation was different and prices were stable.', 6.2],
  ['I searched for the numbers and the results were all over the place.', 6.2],
  ['Recently the background changed again after new data arrived.', 6.2],
  ['She wrote that the headline was misleading and the numbers were wrong.', 6.2],
  ['Basically it means small habits matter more than big plans.', 3.6],
  ['It started with one person who kept reading the comments.', 6.2],
  ['Several websites listed different sources and many links pointed nowhere.', 6.2],
  ['Currently the situation is that every voice repeats the same claim.', 6.2],
  ['He said "we never expected the numbers to move this fast".', 6.2],
  ['The first step is to track where your money actually goes each week.', 3.6],
  ['Imagine how different your savings would look five years from now.', 6.2],
  ['Search results for this topic show multiple listings and reviews.', 6.2],
  ['Because the important part is the second screen.', 3.6],
  ['There were rumors during the winter and nobody knew why.', 6.2],
  ['They announced it yesterday and posted a statement online.', 6.2],
  ['Scrolling through the feed I found twelve reviews with the same wording.', 6.2],
  ['Once the story spread everybody had a theory.', 6.2],
  ['The official announcement from the authority confirmed the new rule.', 6.2],
  ['In other words, here is how the term works.', 3.6],
  ['Last year the context was completely different.', 6.2],
  ['The report said the loss was bigger than anyone expected.', 6.2],
  ['Multiple links and listings showed up everywhere I looked.', 6.2],
  ['A few days later the situation looked better.', 6.2],
  ['Remember the important thing is the second step.', 3.6],
  ['The caption read "wait for confirmation before you act on this".', 6.2],
  ['Right now the whole situation is still uncertain.', 6.2],
  ['Yes.', 1.6],
  ['Everywhere I looked there were articles and websites.', 6.2],
  ['Picture this: a quiet evening and one notification.', 6.2],
  ['The term is called confirmation bias and it affects everyone.', 3.6],
  ['Years ago nobody talked about this background.', 6.2],
  ['Honestly the simple rule works best for most people.', 3.6],
]);
