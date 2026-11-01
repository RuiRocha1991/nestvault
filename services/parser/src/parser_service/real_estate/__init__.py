"""Real estate imports (NES-102): the owner's mortgage workbook and the CSV templates.

They are not statements: the rows are installments, prepayments, works and payment phases, so they
have their own wire models, their own registry and their own endpoints (`/real-estate/...`). The
statement registry never detects these files and this one never detects a statement; the detection
matrix test runs both against every fixture.
"""
