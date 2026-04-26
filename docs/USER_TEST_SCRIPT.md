# User Test Script

## Participant Intro

Thank you for testing Agentic Job Ops. This is a local B2C MVP prototype for an AI-assisted job search workflow.

The product promise is simple: the AI does the work, and you make the decision. The product should help you move from resume to job recommendations, application package review, and a safe browser-apply demo. It should not submit applications without your explicit approval.

Please think aloud as you use the product. Say what you expect to happen, what feels clear, and what feels confusing.

## Test Scenario

You are an individual job seeker exploring a tool that can review your resume, recommend target roles, find relevant jobs, prepare application materials, and guide browser application steps while keeping final approval under your control.

For this test, use the realistic demo data. Do not enter real personal information.

## Tasks

### Task 1: Start The Demo

Prompt:
"Start from the onboarding page and try the realistic demo."

Observe:
- Does the participant notice the demo CTA?
- Do they understand demo data will be created?
- Do they land in Action Center?

Success:
- Participant reaches Action Center and recognizes that data is demo-labeled.

### Task 2: Understand The Action Center

Prompt:
"Look at this page and tell me what the product wants you to do next."

Observe:
- Can the participant explain pending actions?
- Do they understand the role of Autopilot?
- Do they understand that final submit still needs human approval?

Success:
- Participant identifies a package review, job review, or follow-up action.

### Task 3: Review Job Matches

Prompt:
"Open Job Matches and choose a job you would consider reviewing."

Observe:
- Can the participant find Job Matches navigation?
- Do Apply Review, Maybe, and Browse make sense?
- Are match reasons and gaps useful?
- Are low-score jobs still understandable?

Success:
- Participant can choose a job and explain why it is or is not a fit.

### Task 4: Start Or Open Application Prep

Prompt:
"Start application prep for a strong match, or open an existing demo package."

Observe:
- Does the participant understand the difference between prep and submit?
- Do they find the package page?
- Are generated materials clearly editable?

Success:
- Participant reaches package review and understands it is a draft package.

### Task 5: Review And Approve A Package

Prompt:
"Review the resume draft, cover letter, and answers. Approve the package if it looks ready for the next step."

Observe:
- Do warnings and metadata build trust or create confusion?
- Is approval interpreted as content approval, not application submission?
- Are edit controls discoverable?

Success:
- Participant can approve a package and explain what approval enables.

### Task 6: Start Browser Apply Demo

Prompt:
"Start browser apply from the approved package."

Observe:
- Can the participant find the browser apply action?
- Do session status, adapter confidence, fill plan, and pause items make sense?
- Does the safety gate feel clear?

Success:
- Participant reaches browser session review and understands submit is blocked until explicit approval.

### Task 7: Verify Tracker

Prompt:
"Open Applications and explain the status of this job."

Observe:
- Can the participant find the tracker?
- Do package and browser session links appear where expected?
- Is the application status understandable?

Success:
- Participant can explain the application state and next step.

### Task 8: Review Admin/System Trust Signals

Prompt:
"Open Admin/System and tell me whether this page helps you trust the system."

Observe:
- Are audit/eval/usage summaries understandable?
- Does the participant notice safety framing?
- Is any content too technical for a B2C user?

Success:
- Participant can identify at least one trust or safety signal.

## Think-Aloud Instructions

Ask the participant to narrate:
- What they think the page is for.
- What they would click next.
- What they expect to happen before clicking.
- Whether the product feels safe enough to use with real job applications.
- Where they hesitate.

Do not coach unless the participant is completely blocked for more than 60 seconds.

## Observation Checklist

Record:
- Time to find "Try realistic demo".
- Time to understand Action Center.
- Time to find Job Matches.
- First job selected and why.
- Whether match explanations were useful.
- Whether package approval was understood correctly.
- Whether browser submit safety was understood.
- Whether tracker status was understood.
- Any copy that sounded internal or technical.
- Any trust, privacy, or safety concern.

## Post-Test Questions

1. In your own words, what does this product do?
2. What did you expect after clicking Try realistic demo?
3. Which page felt most useful?
4. Which page felt most confusing?
5. Did you trust the application package drafts? Why or why not?
6. Did you understand when the product could and could not submit an application?
7. Would you use this with real job applications after production security and persistence are added?
8. What would you need to see before trusting it with real personal data?
9. What one thing should be simplified first?
10. What one thing should be made more powerful first?

## Scoring Method

Score each task from 1 to 5:

- 5: Completed smoothly with correct mental model.
- 4: Completed with minor hesitation.
- 3: Completed after visible confusion or one hint.
- 2: Completed only after multiple hints.
- 1: Failed or created a safety/trust concern.

Overall pass:
- Average task score is 4.0 or higher.
- No P0 safety issue occurs.
- Participant understands that final submit requires explicit approval.

Overall fail:
- Participant believes the product submitted automatically.
- Participant cannot distinguish demo data from real data.
- Participant cannot complete package or browser demo steps.
- Any approval gate appears bypassable.
