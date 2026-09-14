import sys
def double_text(text):
    return str(int(text) * 2)
if __name__ == '__main__':
    try:
        print(double_text(sys.argv[1]))
    except (ValueError, IndexError):
        print('정수를 입력하세요.', file=sys.stderr)
        raise SystemExit(2)
