from services.user_service import UserService


def main() -> None:
    user_service = UserService()
    user = user_service.create_user("Ada Lovelace", "ada@example.com")
    print(user.display_name())


if __name__ == "__main__":
    main()
