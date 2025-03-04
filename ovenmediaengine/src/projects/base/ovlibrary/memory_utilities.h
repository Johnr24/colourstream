#pragma once

#define OV_COUNTOF(arr) (sizeof(arr) / sizeof((arr)[0]))
#define OV_PTR_FORMAT "0x%016" PRIxPTR

#if __cplusplus
#	define OV_GLOBAL_NAMESPACE_PREFIX ::
#else  // __cplusplus
#	define OV_GLOBAL_NAMESPACE_PREFIX
#endif	// __cplusplus

// If <x> is not equal to <value>, execute <exec>, and put <value> in <var>
#define OV_SAFE_RESET(x, value, exec, var) \
	do                                     \
	{                                      \
		if ((x) != (value))                \
		{                                  \
			exec;                          \
			(var) = (value);               \
		}                                  \
	} while (false)

// Example:
//
// OV_SAFE_FUNC(val, nullptr, close_func, &)
//
// if(val != nullptr)
// {
//   close_func(& val);
//   val = nullptr
// }
#define OV_SAFE_FUNC(x, value, func, prefix) OV_SAFE_RESET(x, value, func(prefix(x)), x)

#define OV_SAFE_DELETE(x) OV_SAFE_FUNC(x, nullptr, delete, )
#define OV_SAFE_FREE(x) OV_SAFE_FUNC(x, nullptr, OV_GLOBAL_NAMESPACE_PREFIX free, )	 // NOLINT
#define OV_CHECK_FLAG(x, flag) (((x) & (flag)) == (flag))

#if __cplusplus
namespace ov
{
	template <typename T, typename = std::enable_if_t<std::is_enum_v<T>>, typename U = typename std::underlying_type_t<T>>
	inline bool CheckFlag(const T &lhs, const T &rhs)
	{
		return OV_CHECK_FLAG(static_cast<const U>(lhs), static_cast<const U>(rhs));
	}

	template <typename T, typename = std::enable_if_t<std::is_enum_v<T>>, typename U = typename std::underlying_type_t<T>>
	inline bool CheckFlag(const T &lhs, const U &rhs)
	{
		return OV_CHECK_FLAG(static_cast<const U>(lhs), static_cast<const U>(rhs));
	}

	template <typename T, typename = std::enable_if_t<std::is_enum_v<T>>, typename U = typename std::underlying_type_t<T>>
	inline bool CheckFlag(const U &lhs, const T &rhs)
	{
		return OV_CHECK_FLAG(static_cast<const U>(lhs), static_cast<const U>(rhs));
	}
}  // namespace ov
#endif	// __cplusplus

// Gets the <index>th bit from the value (0-based)
// You can use (((value) & (1 << index)) >> index) instead of the expression below
//
// Example)
//  ~: indicates the bit of the part to be calculated
//  !: is a bit generated by shift operation
//
// OV_GET_BIT(0b1010, 2) == 0b0
//               ~            ~
// If the value is 4-bits,
// (0b1010 >> 2) & 0b1 = 0b0010 & 0b1 = 0b0000 = 0b0
//     ~                   !! ~              ~     ~
#define OV_GET_BIT(value, index) (((value) >> (index)) & 1)

// Gets bits from <index>th to <index + count>th from the value (0-based)
//
// Example)
//  ~: indicates the bit of the part to be calculated
//  !: is a bit generated by shift operation
//
// OV_GET_BITS(0b00111100, 5, 2) == 0b01
//                ~~                  ~~
//
// If the value is 8-bits,
//
// 1) Operate the value as left shift as <index + count>. - Make it MSB(Most Significant Bit)
// (0b00111100 << (8 - (index + count)) = (0b00111100 << 1) = 0b01111000
//     ~~                                     ~~                ~~     !
// 2) Extract value by operating right shift as (index + (8 - (index + count))),
//    in this case, (8 - count), calculated above
// 0b01111000 >> (8 - count) = 0b01111000 >> 6 = 0b00000001 = 0b01
//   ~~     !                    ~~     ~          !!!!!!~~     ~~
#define OV_GET_BITS(type, value, index, count) ((type)((type)(((type)(value)) << ((sizeof(type) * 8) - ((index) + (count)))) >> ((sizeof(type) * 8) - (count))))