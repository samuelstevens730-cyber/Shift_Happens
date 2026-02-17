# Employee Score Beta Spec

## Status
- Public Beta (transparent to all employees)
- Not sole Employee of the Month determinant yet
- Scores are for feedback, coaching, and behavior alignment

## Window
- Default rolling window: last 30 days
- Configurable via `from` / `to`
- Minimum shifts to be ranked: 8

## Categories and Weights
- Sales (Raw + Adjusted): 30 points
- Reliability (Attendance + Punctuality): 30 points
- Accuracy (Drawer Start->End variance): 20 points
- Cash Handling (Safe closeout variance): 10 points
- Task Master (Cleaning completed vs skipped): 10 points
- Total: 100 points

## Formulas

### Sales (30)
- `raw_avg_shift_sales` computed from shift sales report rules.
- `adjusted_avg_shift_sales` uses per-store normalization factor:
  - `store_factor = network_avg_store_total / store_total`
  - `adjusted_shift_sales = raw_shift_sales * store_factor`
- Split into two 15-point components using percentile rank:
  - `sales_raw_score = 15 * percentile(raw_avg_shift_sales)`
  - `sales_adjusted_score = 15 * percentile(adjusted_avg_shift_sales)`

### Reliability (30)
- Attendance (15):
  - `attendance_rate = worked_scheduled_shifts / scheduled_shifts`
  - `attendance_score = 15 * clamp(attendance_rate, 0, 1)`
- Punctuality (15):
  - `avg_late_minutes = avg(max(0, actual_start - scheduled_start))`
  - `punctuality_factor = clamp(1 - avg_late_minutes / 15, 0, 1)`
  - `punctuality_score = 15 * punctuality_factor`

### Accuracy (20)
- `drawer_delta_abs_avg = avg(abs(end_drawer_cents - start_drawer_cents))`
- `accuracy_factor = clamp(1 - drawer_delta_abs_avg / 2000, 0, 1)` (`$20` threshold)
- `accuracy_score = 20 * accuracy_factor`

### Cash Handling (10)
- `closeout_variance_abs_avg = avg(abs(safe_closeout.variance_cents))`
- `cash_factor = clamp(1 - closeout_variance_abs_avg / 1000, 0, 1)` (`$10` threshold)
- `cash_handling_score = 10 * cash_factor`

### Task Master (10)
- `completion_rate = completed / (completed + skipped)`
- `task_score = 10 * clamp(completion_rate, 0, 1)`

## Data Availability Rules
- Some historical periods may be incomplete.
- Any category with no usable data is marked `N/A`.
- Final score is normalized to available categories:
  - `final = (earned_points / available_points) * 100`

## Grades
- A: 90-100
- B: 75-89
- C: 60-74
- D: <60

## Transparency
- Score breakdown shows every category and formula basis.
- Public leaderboard includes:
  - rank
  - total score
  - grade
  - key category scores
