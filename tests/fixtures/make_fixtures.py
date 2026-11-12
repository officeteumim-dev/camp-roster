# Builds made-up Camp Flow reports for the tests (same columns as the real "All families" report; no real data).
# Run: python3 tests/fixtures/make_fixtures.py
import os
from openpyxl import Workbook

here = os.path.dirname(os.path.abspath(__file__))

FAM_HEADERS = ['Family Link', 'Father title', 'Mother title', 'Father first name', 'Mother first name', 'Last name', 'Camper names',
  'Camper count', 'Marital status', 'Maiden name', 'Father phone', 'Mother phone', 'Father email', 'Mother email', 'Father occupation',
  'Mother occupation', 'Address', 'City', 'State', 'Zip', 'Affiliation', 'Colony Address', 'Total charges', 'Total payments', 'Balance',
  'Pending payments', 'Upcoming autopay', 'Balance after expected payments', 'Payment Methods', 'Active Autopay', 'Paused Autopay',
  'Emergency Contact 1', 'Emergency Contact 2', 'Family Office Notes', 'Communication notes', 'Applied date',
  'Disclosure: Payment Agreement', 'Disclosure: Photo/Video Release', 'Disclosure: Medical Authorization', 'Disclosure: Legal Authorization']

families = [
  (10001, 'Rabbi', 'Mrs', 'Moshe', 'Rivka', 'Levi', 'Yosef, Chaim', 2, 'Married', 'Katz', '(732) 555-0101', '(732) 555-0102', 'moshe@example.org', 'rivka@example.org', 'Rebbe', 'Teacher', '12 Oak St', 'Lakewood', 'New Jersey', '08701', 'Yeshiva A', '', '$3,200.00', '$1,000.00', '$2,200.00', '', '', '', 1, '', '', 'Sara Katz (Aunt) — (732) 555-0199', '', '', '', '11/05/2026 2:30 pm', 'Yes', 'Yes', 'Yes', 'Yes'),
  (10002, 'Mr', 'Mrs', 'Dovid', 'Leah', 'Cohen', 'Shmuel', 1, 'Married', 'Stern', '(845) 555-0201', '(845) 555-0202', 'dovid@example.org', '', 'Accountant', '', '4 Elm Ave', 'Monsey', 'New York', '10952', 'Yeshiva B', '', '', '', '', '', '', '', 0, '', '', 'Avi Stern (Uncle) — (845) 555-0299', '', '', '', '10/28/2026 9:05 am', 'Yes', 'No', 'Yes', 'Yes'),
  (10003, 'Mr', 'Mrs', 'Ari', 'Dina', 'Levi', 'Eli', 1, 'Married', 'Weiss', '(718) 555-0301', '', 'ari@example.org', 'dina@example.org', '', '', '9 Pine Rd', 'Brooklyn', 'New York', '11219', '', '', '', '', '', '', '', '', 0, '', '', '', '', '', '', '11/01/2026 7:45 pm', 'Yes', 'Yes', 'No', 'Yes'),
]

def families_report(path, rows):
  wb = Workbook(); ws = wb.active; ws.title = 'Worksheet'; ws.append(FAM_HEADERS)
  for r in rows:
    link = f'https://app.campflow.org/families/{r[0]}'
    ws.append([f'=HYPERLINK("{link}","{link}")'] + list(r[1:]))
  wb.save(path)

families_report(os.path.join(here, 'families.xlsx'), families)
families_report(os.path.join(here, 'families_small.xlsx'), families[:1])

wb = Workbook(); ws = wb.active; ws.title = 'Campers'
ws.append(['Camper Link', 'Family Link', 'First name', 'Last name', 'Date of birth', 'Gender', 'Grade', 'Sessions', 'Bunk', 'Legal first name', 'Hebrew name', 'Staff child'])
ws.append(['https://app.campflow.org/campers/501', 'https://app.campflow.org/families/10001', 'Yosef', 'Levi', '03/14/2013', 'Male', '8th', 'First Half, Second Half', '', 'Joseph', 'Yosef', 'No'])
ws.append(['https://app.campflow.org/campers/502', 'https://app.campflow.org/families/10001', 'Chaim', 'Levi', '2015-07-02', 'Male', '6th', 'Second Half', '', '', 'Chaim', 'Yes'])
ws.append(['https://app.campflow.org/campers/503', 'https://app.campflow.org/families/10002', 'Shmuel', 'Cohen', 41700, 'Male', '7th', 'First Half', 'Bunk 3'])
ws.append(['https://app.campflow.org/campers/504', 'https://app.campflow.org/families/99999', 'Nobody', 'Unknown', '', '', '', '', ''])
wb.save(os.path.join(here, 'campers.xlsx'))

wb = Workbook(); ws = wb.active
ws.append(['Transaction ID', 'Date', 'Family Link', 'Type', 'Description', 'Amount'])
ws.append(['T1', '10/01/2026', 'https://app.campflow.org/families/10001', 'Charge', 'Tuition, First Half', '$1,600.00'])
ws.append(['T2', '10/02/2026', 'https://app.campflow.org/families/10001', 'Payment', 'Card', '-$1,000.00'])
ws.append(['T3', '10/03/2026', 'https://app.campflow.org/families/10001', 'Scholarship', 'Sibling discount', '($200.00)'])
wb.save(os.path.join(here, 'transactions.xlsx'))
print('fixtures written')
