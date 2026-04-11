# Test Scenario: {Scenario Name}

## Overview
{Describe what this scenario verifies in 1-2 sentences}

## Prerequisites
- {App is installed on the device}
- {Logged in with a specific account, if needed}
- {Network connectivity state}

## Test Steps

### Step 1: {Screen Entry}
- **Action**: {Launch app and navigate to a specific screen}
- **Expected logcat**:
  - `ATP_SCREEN` → `enter: {ActivityName}`
- **Verify**: {Screen loaded successfully}

### Step 2: {User Input}
- **Action**: {Enter data into fields and tap a button}
- **Input**: {Data to enter}
- **Tap target**: `resource-id: {btn_submit}`
- **Expected logcat**:
  - `ATP_RENDER` → `renderState: screen={ScreenName}, btnVisible=true, isLoading=false`
- **Verify**: {Button is in active state}

### Step 3: {API Call & Response}
- **Action**: {Wait for API call after button tap}
- **Expected logcat**:
  - `ATP_API` → `apiResponse: endpoint={GET /api/data}, status=200, body={...}`
  - `ATP_RENDER` → `renderState: screen={ScreenName}, hasData=true, listCount=5`
- **Verify**:
  - API response status is 200
  - Data is reflected on screen (hasData=true)

### Step 4: {Visual Verification — Tier 3 if needed}
- **Action**: {Verify image rendering on screen}
- **Verify method**: screenshot
- **Verify**:
  - Profile image is rendered
  - Layout is not broken

## Expected Result
{Describe the expected final state when the entire scenario passes}

## Troubleshooting
- {Step 2 failure: check resource-id}
- {Step 3 failure: check API endpoint URL}
- {Step 4 failure: check image URL accessibility}
