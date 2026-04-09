import sys
import json

def main():
    # Echo bot for safeMS
    for line in sys.stdin:
        try:
            data = json.loads(line)
            if data.get('type') == 'group_message':
                # Don't echo own messages or system messages
                if data.get('senderId') == 'echo_bot' or data.get('senderId') == 'system':
                    continue
                    
                response = {
                    'type': 'message',
                    'groupId': data['groupId'],
                    'content': f"Echo Bot: {data['content']}"
                }
                print(json.dumps(response))
                sys.stdout.flush()
            elif data.get('type') == 'message':
                if data.get('senderId') == 'echo_bot':
                    continue
                    
                response = {
                    'type': 'message',
                    'receiverId': data['senderId'],
                    'content': f"Echo Bot: I received your encrypted message!"
                }
                print(json.dumps(response))
                sys.stdout.flush()
        except Exception as e:
            sys.stderr.write(f"Error: {str(e)}\n")
            sys.stderr.flush()

if __name__ == "__main__":
    main()
